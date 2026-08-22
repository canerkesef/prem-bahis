-- ============================================================
--  Oyun Kurallari guncellemesi
--  KURAL 13: Bakiyesi minimum kupon tutarindan az kalan ve bekleyen
--  kuponu olmayan oyuncu "Kaybetti" (eliminated) olarak isaretlenir.
--  Supabase -> SQL Editor -> bu dosyayi yapistir -> RUN
--  (Uygulama acilista bu sutunu otomatik de ekler; elle calistirmak sart degil.)
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS eliminated boolean NOT NULL DEFAULT false;

-- Ilk yari skoru (sonradan football-data'dan doldurulabilir). NULL => islenmedi.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS ht_home integer;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS ht_away integer;
