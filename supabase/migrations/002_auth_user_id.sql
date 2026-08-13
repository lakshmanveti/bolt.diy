-- BuildLive: bind chats/snapshots to Supabase Auth (auth.uid())
-- Run after 001_chats.sql in the SQL editor.
-- Also enable Email auth in: Authentication → Providers → Email

-- Allow null owner_key once user_id is set
alter table public.chats
  alter column owner_key drop not null;

alter table public.snapshots
  alter column owner_key drop not null;

alter table public.chats
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

alter table public.snapshots
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

create index if not exists chats_user_id_idx on public.chats (user_id);
create index if not exists chats_user_updated_idx on public.chats (user_id, updated_at desc);
create index if not exists snapshots_user_id_idx on public.snapshots (user_id);

-- Replace owner_key uniqueness with per-user url_id uniqueness
alter table public.chats drop constraint if exists chats_owner_key_url_id_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chats_user_id_url_id_key'
  ) then
    alter table public.chats add constraint chats_user_id_url_id_key unique (user_id, url_id);
  end if;
exception
  when duplicate_object then null;
  when unique_violation then null;
end $$;

-- Lock down RLS: only the signed-in user sees their rows
drop policy if exists "chats_owner_all" on public.chats;
drop policy if exists "snapshots_owner_all" on public.snapshots;
drop policy if exists "chats_user_all" on public.chats;
drop policy if exists "snapshots_user_all" on public.snapshots;

create policy "chats_user_all" on public.chats
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "snapshots_user_all" on public.snapshots
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Claim anonymous device rows (owner_key) into the current user on first login
create or replace function public.claim_device_chats(p_owner_key text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed integer := 0;
begin
  if auth.uid() is null or p_owner_key is null or length(trim(p_owner_key)) = 0 then
    return 0;
  end if;

  update public.chats
  set user_id = auth.uid(),
      owner_key = null,
      updated_at = now()
  where owner_key = p_owner_key
    and user_id is null;

  get diagnostics claimed = row_count;

  update public.snapshots
  set user_id = auth.uid(),
      owner_key = null,
      updated_at = now()
  where owner_key = p_owner_key
    and user_id is null;

  return claimed;
end;
$$;

revoke all on function public.claim_device_chats(text) from public;
grant execute on function public.claim_device_chats(text) to authenticated;
