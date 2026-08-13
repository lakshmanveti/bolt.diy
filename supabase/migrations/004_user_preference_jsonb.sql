-- Migrate legacy fixed-column user_preference (if 003 was applied with provider/model columns)
-- Safe to run even on fresh installs (no-op when columns are absent)

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_preference'
      and column_name = 'provider'
  ) then
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_preference'
      and column_name = 'preferences'
  ) then
    alter table public.user_preference add column preferences jsonb not null default '{}'::jsonb;
  end if;

    update public.user_preference
    set preferences = coalesce(preferences, '{}'::jsonb) || jsonb_build_object(
      'llm',
      jsonb_strip_nulls(
        jsonb_build_object(
          'provider', provider,
          'model', model,
          'apiKeys', coalesce(api_keys, '{}'::jsonb),
          'providerSettings', provider_settings
        )
      )
    )
    where provider is not null or model is not null;

    alter table public.user_preference drop column if exists provider;
    alter table public.user_preference drop column if exists model;
    alter table public.user_preference drop column if exists api_keys;
    alter table public.user_preference drop column if exists provider_settings;
  end if;
end $$;

create index if not exists user_preference_preferences_gin on public.user_preference using gin (preferences);
