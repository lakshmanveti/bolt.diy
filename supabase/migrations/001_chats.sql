-- BuildLive chat persistence (replaces IndexedDB as source of truth)
-- Run in your Supabase SQL editor.

create extension if not exists "pgcrypto";

-- Device / owner key until real auth is wired (localStorage UUID).
-- When you add Supabase Auth, migrate owner_key → auth.uid().

create table if not exists public.chats (
  id text primary key,
  owner_key text not null,
  url_id text,
  description text,
  messages jsonb not null default '[]'::jsonb,
  metadata jsonb,
  timestamp timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_key, url_id)
);

create index if not exists chats_owner_key_idx on public.chats (owner_key);
create index if not exists chats_owner_updated_idx on public.chats (owner_key, updated_at desc);

create table if not exists public.snapshots (
  chat_id text primary key references public.chats (id) on delete cascade,
  owner_key text not null,
  snapshot jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists snapshots_owner_key_idx on public.snapshots (owner_key);

-- Open policies keyed by owner_key passed from the client.
-- Tighten these when Supabase Auth is added (auth.uid()).
alter table public.chats enable row level security;
alter table public.snapshots enable row level security;

drop policy if exists "chats_owner_all" on public.chats;
create policy "chats_owner_all" on public.chats
  for all
  using (true)
  with check (true);

drop policy if exists "snapshots_owner_all" on public.snapshots;
create policy "snapshots_owner_all" on public.snapshots
  for all
  using (true)
  with check (true);

-- Optional: prefer filtering by owner_key in the app; RLS above is permissive for MVP.
-- Replace with:
--   using (owner_key = current_setting('request.headers', true)::json->>'x-owner-key')
-- once you pass a custom header / JWT claim.
