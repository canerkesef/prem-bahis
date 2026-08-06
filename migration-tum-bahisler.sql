-- ============================================================
--  Zengin bahis pazarlari icin tek JSON kolonu
--  Supabase -> SQL Editor -> yapistir -> RUN (bir kez)
--  (Onceki ayri oran kolonlari artik kullanilmiyor; sorun olmaz.)
-- ============================================================
alter table matches add column if not exists markets jsonb;
