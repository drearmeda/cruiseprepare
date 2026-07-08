-- Cruise Prepare — data model (household auth)
-- Users belong to one household; adults share one plan JSON blob.
-- Kids are people chips inside the plan, not accounts.

create table if not exists users (
  id            serial primary key,
  username      text not null unique,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

create table if not exists households (
  id           serial primary key,
  name         text not null,
  invite_code  text not null unique,
  created_at   timestamptz not null default now()
);

create table if not exists household_members (
  household_id int not null references households(id) on delete cascade,
  user_id      int not null references users(id) on delete cascade,
  role         text not null check (role in ('owner','adult')),
  primary key (household_id, user_id),
  unique (user_id)
);

create table if not exists plans (
  household_id int primary key references households(id) on delete cascade,
  data         jsonb not null,
  updated_at   timestamptz not null default now()
);
