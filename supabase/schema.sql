-- Parcel Pulse schema. No PostGIS required.
-- Parcels live as GeoJSON on the map row; the tables that grow are votes + comments.

create extension if not exists pgcrypto;

create table if not exists maps (
  id          uuid primary key default gen_random_uuid(),
  question    text not null,
  parcels     jsonb not null,
  admin_token text not null unique,
  is_open     boolean not null default true,
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

create table if not exists comments (
  id         uuid primary key default gen_random_uuid(),
  map_id     uuid not null references maps(id) on delete cascade,
  parcel_id  text not null,
  voter_id   text not null,
  body       text not null,
  created_at timestamptz not null default now()
);

create index if not exists comments_map_idx on comments (map_id);
create index if not exists comments_parcel_idx on comments (map_id, parcel_id);

-- All access happens server-side with the service role key, which bypasses RLS.
-- Enable RLS with no public policies so the anon/public key cannot read or write directly.
alter table maps     enable row level security;
alter table votes    enable row level security;
alter table comments enable row level security;
