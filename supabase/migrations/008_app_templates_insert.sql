-- Allow first-time template inserts with the anon key (local Vite has no service role).
-- Category stays unique, so a second insert of the same app type is rejected.

drop policy if exists "app_templates_insert_none" on public.app_templates;
drop policy if exists "app_templates_insert_all" on public.app_templates;
create policy "app_templates_insert_all" on public.app_templates
  for insert
  with check (true);
