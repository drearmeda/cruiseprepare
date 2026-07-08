/* Cruise Prepare — auth + household plan API
   Serves the app (index.html) and stores each household's plan in Postgres
   (or in-memory when DATABASE_URL is unset).
*/
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const cookieSession = require('cookie-session');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-change-me-in-production';
const isProd = process.env.NODE_ENV === 'production';

app.use(cookieSession({
  name: 'cp_sess',
  keys: [SESSION_SECRET],
  maxAge: 1000 * 60 * 60 * 24 * 90, // 90 days
  httpOnly: true,
  sameSite: 'lax',
  secure: isProd
}));

const DB_URL = process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim();
let store;
let pool = null;
let initDb = async () => {};

function pgPoolConfig(url) {
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || /sslmode=disable/i.test(url);
  if (isLocal) return { connectionString: url };

  // pg 8.22+ treats sslmode=require in the URL as verify-full, which rejects DO's cert chain.
  // Strip sslmode from the URL and configure SSL explicitly instead.
  const normalized = url.replace(/^postgres:\/\//, 'postgresql://');
  const parsed = new URL(normalized);
  parsed.searchParams.delete('sslmode');
  const connectionString = parsed.toString().replace(/^postgresql:\/\//, 'postgres://');

  const ca = process.env.DB_CA_CERT || process.env.CA_CERT;
  const ssl = ca
    ? { rejectUnauthorized: true, ca }
    : { rejectUnauthorized: false };

  return { connectionString, ssl };
}

function logDbTarget(url) {
  if (!url) {
    console.log('DATABASE_URL not set — using in-memory store');
    return;
  }
  if (url.includes('${')) {
    console.error('DATABASE_URL looks unresolved — link the database to the web service in DO');
    return;
  }
  try {
    const u = new URL(url.replace(/^postgres:\/\//, 'postgresql://'));
    console.log('DATABASE_URL host:', u.hostname);
  } catch {
    console.error('DATABASE_URL is set but could not be parsed');
  }
}

logDbTarget(DB_URL);

function blankPlan() {
  return {
    v: 2,
    people: ['Me'],
    active: 0,
    outfits: {},
    labels: {},
    formal: { 3: true, 7: true },
    notes: {},
    packed: {},
    need: {},
    custom: {},
    deadlines: []
  };
}

function randInvite() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) s += chars[bytes[i] % chars.length];
  return s;
}

function normalizeUsername(u) {
  return String(u || '').trim().toLowerCase();
}

function validPassword(p) {
  return typeof p === 'string' && p.length >= 8;
}

if (DB_URL) {
  const { Pool } = require('pg');
  pool = new Pool(pgPoolConfig(DB_URL));
  pool.on('error', err => console.error('pg pool error (recovering):', err.message));

  const initSql = `
    create table if not exists users (
      id serial primary key,
      username text not null unique,
      password_hash text not null,
      created_at timestamptz not null default now()
    );
    create table if not exists households (
      id serial primary key,
      name text not null,
      invite_code text not null unique,
      created_at timestamptz not null default now()
    );
    create table if not exists household_members (
      household_id int not null references households(id) on delete cascade,
      user_id int not null references users(id) on delete cascade,
      role text not null check (role in ('owner','adult')),
      primary key (household_id, user_id),
      unique (user_id)
    );
    do $$ begin
      if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'plans' and column_name = 'code'
      ) then
        drop table plans;
      end if;
    end $$;
    create table if not exists plans (
      household_id int primary key references households(id) on delete cascade,
      data jsonb not null,
      updated_at timestamptz not null default now()
    );
  `;
  async function runInitDb() {
    await pool.query(initSql);
    await pool.query('select 1');
  }
  initDb = runInitDb;

  store = {
    async createUser(username, passwordHash) {
      const r = await pool.query(
        'insert into users (username, password_hash) values ($1, $2) returning id, username',
        [username, passwordHash]
      );
      return r.rows[0];
    },
    async findUserByUsername(username) {
      const r = await pool.query(
        'select id, username, password_hash from users where username = $1',
        [username]
      );
      return r.rows[0] || null;
    },
    async findUserById(id) {
      const r = await pool.query('select id, username from users where id = $1', [id]);
      return r.rows[0] || null;
    },
    async createHousehold(name, inviteCode) {
      const r = await pool.query(
        'insert into households (name, invite_code) values ($1, $2) returning id, name, invite_code',
        [name, inviteCode]
      );
      return r.rows[0];
    },
    async findHouseholdByInvite(code) {
      const r = await pool.query(
        'select id, name, invite_code from households where invite_code = $1',
        [code]
      );
      return r.rows[0] || null;
    },
    async addMember(householdId, userId, role) {
      await pool.query(
        'insert into household_members (household_id, user_id, role) values ($1, $2, $3)',
        [householdId, userId, role]
      );
    },
    async membershipForUser(userId) {
      const r = await pool.query(
        `select hm.role, h.id, h.name, h.invite_code
         from household_members hm
         join households h on h.id = hm.household_id
         where hm.user_id = $1`,
        [userId]
      );
      return r.rows[0] || null;
    },
    async membersOf(householdId) {
      const r = await pool.query(
        `select u.id, u.username, hm.role
         from household_members hm
         join users u on u.id = hm.user_id
         where hm.household_id = $1
         order by hm.role desc, u.username`,
        [householdId]
      );
      return r.rows;
    },
    async putPlan(householdId, data) {
      await pool.query(
        `insert into plans (household_id, data, updated_at) values ($1, $2, now())
         on conflict (household_id) do update set data = excluded.data, updated_at = now()`,
        [householdId, data]
      );
    },
    async getPlan(householdId) {
      const r = await pool.query('select data from plans where household_id = $1', [householdId]);
      return r.rows[0] ? r.rows[0].data : null;
    }
  };
  console.log('Persistence: Postgres');
} else {
  let nextUser = 1;
  let nextHousehold = 1;
  const users = new Map(); // id -> {id, username, password_hash}
  const usersByName = new Map();
  const households = new Map();
  const householdsByInvite = new Map();
  const members = new Map(); // userId -> {household_id, user_id, role}
  const plans = new Map();

  store = {
    async createUser(username, passwordHash) {
      if (usersByName.has(username)) {
        const err = new Error('username taken');
        err.code = '23505';
        throw err;
      }
      const u = { id: nextUser++, username, password_hash: passwordHash };
      users.set(u.id, u);
      usersByName.set(username, u);
      return { id: u.id, username: u.username };
    },
    async findUserByUsername(username) {
      return usersByName.get(username) || null;
    },
    async findUserById(id) {
      const u = users.get(id);
      return u ? { id: u.id, username: u.username } : null;
    },
    async createHousehold(name, inviteCode) {
      const h = { id: nextHousehold++, name, invite_code: inviteCode };
      households.set(h.id, h);
      householdsByInvite.set(inviteCode, h);
      return h;
    },
    async findHouseholdByInvite(code) {
      return householdsByInvite.get(code) || null;
    },
    async addMember(householdId, userId, role) {
      if (members.has(userId)) {
        const err = new Error('already in household');
        err.code = '23505';
        throw err;
      }
      members.set(userId, { household_id: householdId, user_id: userId, role });
    },
    async membershipForUser(userId) {
      const m = members.get(userId);
      if (!m) return null;
      const h = households.get(m.household_id);
      return { role: m.role, id: h.id, name: h.name, invite_code: h.invite_code };
    },
    async membersOf(householdId) {
      const rows = [];
      for (const m of members.values()) {
        if (m.household_id === householdId) {
          const u = users.get(m.user_id);
          rows.push({ id: u.id, username: u.username, role: m.role });
        }
      }
      rows.sort((a, b) => (a.role === b.role ? a.username.localeCompare(b.username) : a.role === 'owner' ? -1 : 1));
      return rows;
    },
    async putPlan(householdId, data) {
      plans.set(householdId, data);
    },
    async getPlan(householdId) {
      return plans.has(householdId) ? plans.get(householdId) : null;
    }
  };
  console.log('Persistence: in-memory (no DATABASE_URL — data resets on restart)');
}

async function requireAuth(req, res, next) {
  const userId = req.session && req.session.userId;
  if (!userId) return res.status(401).json({ error: 'not signed in' });
  try {
    const user = await store.findUserById(userId);
    if (!user) {
      req.session = null;
      return res.status(401).json({ error: 'not signed in' });
    }
    const mem = await store.membershipForUser(userId);
    if (!mem) return res.status(401).json({ error: 'no household' });
    req.user = user;
    req.household = {
      id: mem.id,
      name: mem.name,
      inviteCode: mem.invite_code,
      role: mem.role
    };
    next();
  } catch (e) {
    console.error('auth error:', e.message);
    res.status(500).json({ error: 'server error' });
  }
}

async function mePayload(user, household) {
  const members = await store.membersOf(household.id);
  return {
    user: { id: user.id, username: user.username },
    household: {
      id: household.id,
      name: household.name,
      inviteCode: household.inviteCode,
      role: household.role,
      members: members.map(m => ({ id: m.id, username: m.username, role: m.role }))
    }
  };
}

// --- Auth ---
app.post('/api/auth/signup', async (req, res) => {
  try {
    const username = normalizeUsername(req.body && req.body.username);
    const password = req.body && req.body.password;
    const householdName = String((req.body && req.body.householdName) || '').trim();
    if (!username || username.length < 3) return res.status(400).json({ error: 'username must be at least 3 characters' });
    if (!/^[a-z0-9._-]+$/.test(username)) return res.status(400).json({ error: 'username: letters, numbers, . _ - only' });
    if (!validPassword(password)) return res.status(400).json({ error: 'password must be at least 8 characters' });
    if (!householdName) return res.status(400).json({ error: 'household name required' });

    const existing = await store.findUserByUsername(username);
    if (existing) return res.status(409).json({ error: 'username already taken' });

    const hash = await bcrypt.hash(password, 10);
    const user = await store.createUser(username, hash);
    let invite = randInvite();
    let household;
    for (let i = 0; i < 5; i++) {
      try {
        household = await store.createHousehold(householdName, invite);
        break;
      } catch (e) {
        if (e.code === '23505') invite = randInvite();
        else throw e;
      }
    }
    if (!household) return res.status(500).json({ error: 'could not create household' });
    await store.addMember(household.id, user.id, 'owner');
    const plan = blankPlan();
    plan._t = Date.now();
    await store.putPlan(household.id, plan);

    req.session.userId = user.id;
    const payload = await mePayload(user, {
      id: household.id,
      name: household.name,
      inviteCode: household.invite_code,
      role: 'owner'
    });
    res.json(payload);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'username already taken' });
    console.error('signup error:', e.message);
    res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/auth/join', async (req, res) => {
  try {
    const username = normalizeUsername(req.body && req.body.username);
    const password = req.body && req.body.password;
    const inviteCode = String((req.body && req.body.inviteCode) || '').trim().toUpperCase();
    if (!username || username.length < 3) return res.status(400).json({ error: 'username must be at least 3 characters' });
    if (!/^[a-z0-9._-]+$/.test(username)) return res.status(400).json({ error: 'username: letters, numbers, . _ - only' });
    if (!validPassword(password)) return res.status(400).json({ error: 'password must be at least 8 characters' });
    if (!inviteCode) return res.status(400).json({ error: 'invite code required' });

    const household = await store.findHouseholdByInvite(inviteCode);
    if (!household) return res.status(404).json({ error: 'invite code not found' });

    const existing = await store.findUserByUsername(username);
    if (existing) return res.status(409).json({ error: 'username already taken' });

    const hash = await bcrypt.hash(password, 10);
    const user = await store.createUser(username, hash);
    await store.addMember(household.id, user.id, 'adult');

    req.session.userId = user.id;
    const payload = await mePayload(user, {
      id: household.id,
      name: household.name,
      inviteCode: household.invite_code,
      role: 'adult'
    });
    res.json(payload);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'username already taken or already in a household' });
    console.error('join error:', e.message);
    res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const username = normalizeUsername(req.body && req.body.username);
    const password = req.body && req.body.password;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    const user = await store.findUserByUsername(username);
    if (!user) return res.status(401).json({ error: 'invalid username or password' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid username or password' });
    const mem = await store.membershipForUser(user.id);
    if (!mem) return res.status(401).json({ error: 'no household' });
    req.session.userId = user.id;
    const payload = await mePayload(
      { id: user.id, username: user.username },
      { id: mem.id, name: mem.name, inviteCode: mem.invite_code, role: mem.role }
    );
    res.json(payload);
  } catch (e) {
    console.error('login error:', e.message);
    res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, async (req, res) => {
  try {
    res.json(await mePayload(req.user, req.household));
  } catch (e) {
    console.error('me error:', e.message);
    res.status(500).json({ error: 'server error' });
  }
});

// --- Plan (session-scoped) ---
app.get('/api/plan', requireAuth, async (req, res) => {
  try {
    const data = await store.getPlan(req.household.id);
    if (!data) return res.status(404).json({ error: 'not found' });
    res.json({ data });
  } catch (e) {
    console.error('GET plan error:', e.message);
    res.status(500).json({ error: 'server error' });
  }
});

app.put('/api/plan', requireAuth, async (req, res) => {
  try {
    const data = req.body && req.body.data;
    if (!data || !Array.isArray(data.people)) return res.status(400).json({ error: 'bad payload' });
    await store.putPlan(req.household.id, data);
    res.json({ ok: true });
  } catch (e) {
    console.error('PUT plan error:', e.message);
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/healthz', async (_req, res) => {
  if (!pool) return res.json({ ok: true, db: 'memory' });
  try {
    await pool.query('select 1');
    res.json({ ok: true, db: 'postgres' });
  } catch (e) {
    res.status(503).json({ ok: false, db: 'error', message: e.message });
  }
});

app.use('/assets', express.static(path.join(__dirname, 'assets'), { maxAge: '7d' }));

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const port = process.env.PORT || 8080;

async function start() {
  if (pool) {
    try {
      await initDb();
      console.log('Postgres ready');
    } catch (e) {
      console.error('Postgres startup failed:', e.message);
      process.exit(1);
    }
  }
  app.listen(port, () => console.log('Cruise Prepare listening on ' + port));
}

start();
