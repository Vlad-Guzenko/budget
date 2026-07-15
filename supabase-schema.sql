-- ============================================================
--  Мотофонд · схема Supabase
--  Выполни это в Supabase → SQL Editor → New query → Run
-- ============================================================

-- Траты
create table if not exists public.entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  spent_on    date not null,
  amount      numeric(10,2) not null check (amount > 0),
  created_at  timestamptz not null default now()
);

create index if not exists entries_user_date_idx
  on public.entries (user_id, spent_on);

-- Настройки бюджета (одна строка на пользователя)
create table if not exists public.config (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  living_budget  numeric(10,2) not null default 800,
  total_days     int           not null default 45,
  start_date     date          not null default '2026-07-15',
  base_savings   numeric(10,2) not null default 4039.19,
  updated_at     timestamptz   not null default now()
);

-- ---------- Row Level Security ----------
alter table public.entries enable row level security;
alter table public.config  enable row level security;

-- Каждый видит и меняет только свои строки
drop policy if exists "entries owner" on public.entries;
create policy "entries owner" on public.entries
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "config owner" on public.config;
create policy "config owner" on public.config
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
