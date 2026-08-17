-- Global reusable app templates. First successful live-preview generate wins per category.
-- Templates are shared across all users (not per-owner).

create table if not exists public.app_templates (
  category text primary key,
  title text not null,
  description text not null default '',
  keywords text[] not null default '{}',
  files jsonb not null default '{}'::jsonb,
  start_command text not null default 'npm install && npm run dev',
  source_chat_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_templates_category_slug check (category ~ '^[a-z][a-z0-9_]{1,62}$')
);

create index if not exists app_templates_updated_idx on public.app_templates (updated_at desc);

alter table public.app_templates enable row level security;

drop policy if exists "app_templates_select_all" on public.app_templates;
create policy "app_templates_select_all" on public.app_templates
  for select
  using (true);

-- First insert wins (unique category). No updates from the client.
drop policy if exists "app_templates_insert_none" on public.app_templates;
drop policy if exists "app_templates_insert_all" on public.app_templates;
create policy "app_templates_insert_all" on public.app_templates
  for insert
  with check (true);

drop policy if exists "app_templates_update_none" on public.app_templates;
create policy "app_templates_update_none" on public.app_templates
  for update
  using (false);
