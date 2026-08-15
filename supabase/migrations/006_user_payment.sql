-- Payment history for Billing. Run after 005_user_subscription.sql

create table if not exists public.user_payment (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan text not null check (plan in ('platform', 'hosted')),
  amount_paise integer not null,
  currency text not null default 'INR',
  status text not null default 'captured'
    check (status in ('captured', 'authorized', 'failed', 'refunded')),
  razorpay_order_id text,
  razorpay_payment_id text unique,
  created_at timestamptz not null default now()
);

create index if not exists user_payment_user_created_idx
  on public.user_payment (user_id, created_at desc);

alter table public.user_payment enable row level security;

drop policy if exists "user_payment_select_own" on public.user_payment;
create policy "user_payment_select_own" on public.user_payment
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_payment_write_own" on public.user_payment;
create policy "user_payment_write_own" on public.user_payment
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
