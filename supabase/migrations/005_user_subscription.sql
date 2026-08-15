-- Per-user billing state (Razorpay). Run after 004_user_preference_jsonb.sql
-- Amounts / token caps live in app/lib/billing/plans.ts (env-overridable).

create table if not exists public.user_subscription (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null check (plan in ('platform', 'hosted')),
  status text not null default 'inactive'
    check (status in ('inactive', 'pending', 'active', 'expired', 'canceled')),
  razorpay_order_id text,
  razorpay_payment_id text,
  razorpay_subscription_id text,
  current_period_end timestamptz,
  token_used bigint not null default 0,
  token_cap bigint,
  amount_paise integer,
  currency text not null default 'INR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_subscription_status_idx on public.user_subscription (status);
create index if not exists user_subscription_order_idx on public.user_subscription (razorpay_order_id);

alter table public.user_subscription enable row level security;

drop policy if exists "user_subscription_select_own" on public.user_subscription;
create policy "user_subscription_select_own" on public.user_subscription
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_subscription_upsert_own" on public.user_subscription;
create policy "user_subscription_upsert_own" on public.user_subscription
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
