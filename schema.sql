-- ============================================================
--  Prem Bahis - Supabase (Postgres) tablolari
--  Supabase panelinde: SQL Editor -> bu dosyanin tamamini yapistir -> RUN
--  (Sadece bir kez calistirman yeterli.)
-- ============================================================

create table if not exists users (
  id            bigserial primary key,
  username      text unique not null,
  password_hash text not null,
  is_admin      boolean not null default false,
  status        text not null default 'pending',   -- pending | approved | rejected
  balance       numeric not null default 0,
  created_at    timestamptz not null default now()
);

create table if not exists matches (
  id            text primary key,          -- api event id ya da elle uretilen id
  home_team     text not null,
  away_team     text not null,
  commence_time timestamptz not null,
  status        text not null default 'open', -- open | settled | void
  home_score    integer,
  away_score    integer,
  markets       jsonb,   -- tum bahis pazarlari ve oranlari
  last_update   timestamptz not null default now()
);

create table if not exists coupons (
  id            bigserial primary key,
  user_id       bigint not null references users(id),
  match_id      text not null references matches(id),
  home_team     text not null,
  away_team     text not null,
  commence_time timestamptz not null,
  market        text not null,             -- 1x2 | ou25 | btts
  selection     text not null,             -- 1|X|2 | over|under | yes|no
  odd           numeric not null,
  stake         numeric not null,
  potential_win numeric not null,
  status        text not null default 'pending', -- pending | won | lost | void
  created_at    timestamptz not null default now(),
  settled_at    timestamptz
);

create index if not exists idx_coupons_user on coupons(user_id);
create index if not exists idx_coupons_match on coupons(match_id);
