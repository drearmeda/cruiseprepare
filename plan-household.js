/** Shared household plan helpers (adult tabs, permissions, migration). */

function ensurePersonMeta(plan) {
  if (!plan.personMeta || typeof plan.personMeta !== 'object') plan.personMeta = {};
  return plan;
}

function renamePersonInPlan(plan, from, to) {
  if (from === to) return false;
  const i = plan.people.indexOf(from);
  if (i < 0) return false;
  plan.people[i] = to;
  if (plan.personMeta[from]) {
    plan.personMeta[to] = plan.personMeta[from];
    delete plan.personMeta[from];
  }
  for (const obj of [plan.outfits, plan.packed, plan.need]) {
    if (!obj) continue;
    for (const k of Object.keys(obj)) {
      if (k.startsWith(from + '|')) {
        obj[to + k.slice(from.length)] = obj[k];
        delete obj[k];
      }
    }
  }
  if (plan.custom) {
    for (const k of Object.keys(plan.custom)) {
      if (k.startsWith(from + '|')) {
        plan.custom[to + k.slice(from.length)] = plan.custom[k];
        delete plan.custom[k];
      }
    }
  }
  return true;
}

function mergePersonDataInto(plan, from, to) {
  if (from === to) return;
  for (const obj of [plan.outfits, plan.packed, plan.need]) {
    if (!obj) continue;
    for (const k of Object.keys(obj)) {
      if (k.startsWith(from + '|')) {
        const nk = to + k.slice(from.length);
        if (obj[nk] === undefined) obj[nk] = obj[k];
        delete obj[k];
      }
    }
  }
  if (plan.custom) {
    for (const k of Object.keys(plan.custom)) {
      if (k.startsWith(from + '|')) {
        const nk = to + k.slice(from.length);
        if (plan.custom[nk] === undefined) plan.custom[nk] = plan.custom[k];
        delete plan.custom[k];
      }
    }
  }
  const idx = plan.people.indexOf(from);
  if (idx >= 0) plan.people.splice(idx, 1);
}

function findOwner(members) {
  if (!members || !members.length) return null;
  return members.find(m => m.role === 'owner') || members[0];
}

function mergeHouseholdMembers(plan, members) {
  plan = ensurePersonMeta(plan);
  if (!Array.isArray(plan.people)) plan.people = [];
  for (const m of members) {
    const name = m.username;
    if (!plan.people.includes(name)) plan.people.push(name);
    const existing = plan.personMeta[name] || {};
    plan.personMeta[name] = {
      type: 'adult',
      userId: m.id,
      editGrants: Array.isArray(existing.editGrants) ? existing.editGrants : []
    };
  }
  if (plan.active >= plan.people.length) plan.active = Math.max(0, plan.people.length - 1);
  return plan;
}

function migrateLegacyPlan(plan, members) {
  if (!plan) return plan;
  plan = ensurePersonMeta(plan);
  plan.v = 3;

  const owner = findOwner(members);
  if (owner) {
    const ownerName = owner.username;
    const meIdx = plan.people.indexOf('Me');
    if (meIdx >= 0) {
      if (!plan.people.includes(ownerName)) {
        renamePersonInPlan(plan, 'Me', ownerName);
      } else {
        mergePersonDataInto(plan, 'Me', ownerName);
      }
    }
    if (!plan.personMeta[ownerName]) {
      plan.personMeta[ownerName] = { type: 'adult', userId: owner.id, editGrants: [] };
    }
  }

  for (const name of plan.people) {
    const meta = plan.personMeta[name];
    if (!meta) {
      plan.personMeta[name] = { type: 'guest', addedBy: owner ? owner.id : null, editGrants: [] };
    } else if (!Array.isArray(meta.editGrants)) {
      meta.editGrants = [];
    }
  }

  return mergeHouseholdMembers(plan, members);
}

function blankPlanForUser(username, userId) {
  return {
    v: 3,
    people: [username],
    personMeta: { [username]: { type: 'adult', userId, editGrants: [] } },
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

function canEditPerson(plan, personName, userId) {
  const meta = plan.personMeta && plan.personMeta[personName];
  if (!meta) return false;
  if (meta.type === 'adult' && meta.userId === userId) return true;
  if (meta.type === 'guest' && meta.addedBy === userId) return true;
  return (meta.editGrants || []).includes(userId);
}

function canGrantForPerson(plan, personName, userId) {
  const meta = plan.personMeta && plan.personMeta[personName];
  if (!meta) return false;
  if (meta.type === 'adult' && meta.userId === userId) return true;
  if (meta.type === 'guest' && meta.addedBy === userId) return true;
  return false;
}

function personDataKeys(plan, personName) {
  const keys = [];
  for (const obj of [plan.outfits, plan.packed, plan.need]) {
    if (!obj) continue;
    for (const k of Object.keys(obj)) {
      if (k.startsWith(personName + '|')) keys.push(k);
    }
  }
  if (plan.custom) {
    for (const k of Object.keys(plan.custom)) {
      if (k.startsWith(personName + '|')) keys.push('custom:' + k);
    }
  }
  return keys.sort();
}

function snapshotPersonData(plan, personName) {
  const snap = {};
  for (const obj of [plan.outfits, plan.packed, plan.need]) {
    if (!obj) continue;
    for (const k of Object.keys(obj)) {
      if (k.startsWith(personName + '|')) snap[k] = obj[k];
    }
  }
  if (plan.custom) {
    for (const k of Object.keys(plan.custom)) {
      if (k.startsWith(personName + '|')) snap['custom:' + k] = plan.custom[k];
    }
  }
  return JSON.stringify(snap);
}

function personDataChanged(oldPlan, newPlan, personName) {
  return snapshotPersonData(oldPlan, personName) !== snapshotPersonData(newPlan, personName);
}

function metaEqual(a, b) {
  return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

function validatePlanUpdate(oldPlan, newPlan, userId, members) {
  const migrated = migrateLegacyPlan(JSON.parse(JSON.stringify(oldPlan)), members);
  newPlan = ensurePersonMeta(newPlan);
  if (!Array.isArray(newPlan.people)) return { ok: false, error: 'bad payload' };

  const oldSet = new Set(migrated.people);
  const newSet = new Set(newPlan.people);

  for (const p of oldSet) {
    if (!newSet.has(p) && !canEditPerson(migrated, p, userId)) {
      return { ok: false, error: 'cannot remove ' + p };
    }
  }

  for (const p of newSet) {
    if (!oldSet.has(p)) {
      const meta = newPlan.personMeta[p];
      if (!meta) return { ok: false, error: 'missing person metadata' };
      if (meta.type === 'guest') {
        if (meta.addedBy !== userId) return { ok: false, error: 'cannot add ' + p };
      } else if (meta.type === 'adult') {
        const member = members.find(m => m.username === p);
        if (!member) return { ok: false, error: 'invalid adult ' + p };
      } else {
        return { ok: false, error: 'invalid person type' };
      }
    }
  }

  const allNames = new Set([...oldSet, ...newSet]);
  for (const p of allNames) {
    const oldMeta = migrated.personMeta[p];
    const newMeta = newPlan.personMeta[p];
    if (!metaEqual(oldMeta, newMeta)) {
      const grantsOnly = oldMeta && newMeta
        && oldMeta.type === newMeta.type
        && oldMeta.userId === newMeta.userId
        && oldMeta.addedBy === newMeta.addedBy
        && JSON.stringify(oldMeta.editGrants || []) !== JSON.stringify(newMeta.editGrants || []);
      if (grantsOnly) {
        if (!canGrantForPerson(migrated, p, userId)) {
          return { ok: false, error: 'cannot change sharing for ' + p };
        }
      } else if (!canEditPerson(migrated, p, userId)) {
        return { ok: false, error: 'cannot change metadata for ' + p };
      }
    }
    if (personDataChanged(migrated, newPlan, p) && !canEditPerson(migrated, p, userId)) {
      return { ok: false, error: 'cannot edit ' + p + "'s lists" };
    }
  }

  return { ok: true };
}

function isDefaultBlankPlan(plan) {
  if (!plan || !Array.isArray(plan.people)) return true;
  if (plan.people.length === 1 && plan.people[0] === 'Me') {
    const empty = !(plan.outfits && Object.keys(plan.outfits).length)
      && !(plan.packed && Object.keys(plan.packed).length);
    return empty;
  }
  return false;
}

module.exports = {
  ensurePersonMeta,
  renamePersonInPlan,
  mergeHouseholdMembers,
  mergePersonDataInto,
  migrateLegacyPlan,
  blankPlanForUser,
  canEditPerson,
  canGrantForPerson,
  validatePlanUpdate,
  isDefaultBlankPlan
};
