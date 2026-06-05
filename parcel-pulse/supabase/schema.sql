-- Parcel Pulse schema. No PostGIS required.
-- Tables that grow: votes, comments, participants, sessions.

create extension if not exists pgcrypto;

create table if not exists maps (
  id          uuid primary key default gen_random_uuid(),
  question    text not null,
  parcels     jsonb not null,
  admin_token text not null unique,
  is_open     boolean not null default true,
  vote_limit  integer,
  created_at  timestamptz not null default now()
);

create table if not exists votes (
  id         uuid primary key default gen_random_uuid(),
  map_id     uuid not null references maps(id) on delete cascade,
  parcel_id  text not null,
  voter_id   text not null,
  created_at timestamptz not null default now(),
  unique (map_id, parcel_id, voter_id)
);
create index if not exists votes_map_idx on votes (map_id);
create index if not exists votes_map_voter_idx on votes (map_id, voter_id);

create table if not exists comments (
  id          uuid primary key default gen_random_uuid(),
  map_id      uuid not null references maps(id) on delete cascade,
  parcel_id   text not null,
  voter_id    text not null,
  body        text not null,
  author_name text,
  created_at  timestamptz not null default now()
);
create index if not exists comments_map_idx on comments (map_id);
create index if not exists comments_parcel_idx on comments (map_id, parcel_id);

-- Per-map participant identity (when2meet style: a name + optional password).
create table if not exists participants (
  id            uuid primary key default gen_random_uuid(),
  map_id        uuid not null references maps(id) on delete cascade,
  name          text not null,
  name_key      text not null,
  password_hash text,
  created_at    timestamptz not null default now(),
  unique (map_id, name_key)
);
create index if not exists participants_map_idx on participants (map_id);

-- Opaque session token -> participant.
create table if not exists sessions (
  token          text primary key,
  participant_id uuid not null references participants(id) on delete cascade,
  map_id         uuid not null references maps(id) on delete cascade,
  created_at     timestamptz not null default now()
);
create index if not exists sessions_participant_idx on sessions (participant_id);

-- Aggregation done in the database so map loads transfer per-parcel counts,
-- not every vote/comment row.
create or replace function vote_tally(p_map_id uuid)
returns json language sql stable as $$
  select json_build_object(
    'counts', coalesce((select json_object_agg(parcel_id, c) from (
      select parcel_id, count(*)::int c from votes where map_id = p_map_id group by parcel_id) t), '{}'::json),
    'total_voters', (select count(distinct voter_id)::int from votes where map_id = p_map_id)
  );
$$;

create or replace function comment_tally(p_map_id uuid)
returns json language sql stable as $$
  select coalesce((select json_object_agg(parcel_id, c) from (
    select parcel_id, count(*)::int c from comments where map_id = p_map_id group by parcel_id) t), '{}'::json);
$$;

revoke all on function vote_tally(uuid) from anon, authenticated;
revoke all on function comment_tally(uuid) from anon, authenticated;

-- All access happens server-side with the service role key (bypasses RLS).
alter table maps         enable row level security;
alter table votes        enable row level security;
alter table comments     enable row level security;
alter table participants enable row level security;
alter table sessions     enable row level security;
