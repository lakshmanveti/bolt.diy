-- Flexible per-user preferences (single JSON document — add keys in app without new columns)
-- Run after 002_auth_user_id.sql
-- Example preferences JSON:
--   { "llm": { "provider", "model", "apiKeys", "providerSettings" }, "theme": "dark", ... }

create table if not exists public.user_preference (
  user_id uuid primary key references auth.users (id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists user_preference_updated_idx on public.user_preference (updated_at desc);
create index if not exists user_preference_preferences_gin on public.user_preference using gin (preferences);

alter table public.user_preference enable row level security;

drop policy if exists "user_preference_user_all" on public.user_preference;
create policy "user_preference_user_all" on public.user_preference
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
