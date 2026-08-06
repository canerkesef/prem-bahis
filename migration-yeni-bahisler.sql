-- ============================================================
--  Yeni bahis turleri icin ek oran kolonlari
--  Supabase -> SQL Editor -> bu dosyayi yapistir -> RUN (bir kez)
-- ============================================================
alter table matches
  add column if not exists odd_dc_1x   numeric,
  add column if not exists odd_dc_12   numeric,
  add column if not exists odd_dc_x2   numeric,
  add column if not exists odd_over15  numeric,
  add column if not exists odd_under15 numeric,
  add column if not exists odd_over35  numeric,
  add column if not exists odd_under35 numeric,
  add column if not exists odd_odd     numeric,
  add column if not exists odd_even    numeric,
  add column if not exists odd_h1      numeric,
  add column if not exists odd_hx      numeric,
  add column if not exists odd_h2      numeric;
