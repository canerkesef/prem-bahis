'use strict';

// Supabase (Postgres) baglantisi. Serverless (Vercel) ortaminda calisir.
// DATABASE_URL: Supabase "Connection Pooling" (Transaction, port 6543) URL'i olmali.
const postgres = require('postgres');
const bcrypt = require('bcryptjs');

const connectionString = process.env.DATABASE_URL || '';
if (!connectionString) {
  console.warn('[db] UYARI: DATABASE_URL tanimli degil.');
}

// prepare:false -> Supabase transaction pooler (pgbouncer) ile uyumluluk icin sart.
// (numeric alanlar string donebilir; sunucu tarafinda para hesaplari SQL icinde,
//  arayuze giden degerler Number() ile sayiya cevriliyor.)
const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
const sql = postgres(connectionString, {
  prepare: false,
  ssl: isLocal ? false : 'require',
  max: 3,
  idle_timeout: 20,
});

// Admin hesabini bir kez olusturur (instance basina memoize edilir).
let adminReady = null;
function ensureAdmin() {
  if (adminReady) return adminReady;
  adminReady = (async () => {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'admin1234';
    const startBalance = Number(process.env.START_BALANCE || 1000);
    const rows = await sql`SELECT id FROM users WHERE username = ${username}`;
    if (rows.length === 0) {
      const hash = bcrypt.hashSync(password, 10);
      await sql`
        INSERT INTO users (username, password_hash, is_admin, status, balance)
        VALUES (${username}, ${hash}, true, 'approved', ${startBalance})
        ON CONFLICT (username) DO NOTHING`;
      console.log(`[db] Admin hesabi hazir -> kullanici: ${username}`);
    }
  })().catch((e) => {
    adminReady = null; // hata olursa tekrar denensin
    throw e;
  });
  return adminReady;
}

// Sema guncellemeleri (var olan Supabase veritabanina otomatik uygulanir).
// KURAL 13 icin: elenmis (Kaybetti) oyuncu bayragi.
let schemaReady = null;
function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS eliminated boolean NOT NULL DEFAULT false`;
    // Ilk yari skoru (sonradan doldurulabilir). NULL => devre skoru henuz islenmedi.
    await sql`ALTER TABLE matches ADD COLUMN IF NOT EXISTS ht_home integer`;
    await sql`ALTER TABLE matches ADD COLUMN IF NOT EXISTS ht_away integer`;
    // Otomatik sonuclandirma icin: son otomatik yenileme zamani (soguma/kilit).
    await sql`CREATE TABLE IF NOT EXISTS app_state (id int PRIMARY KEY, last_auto_settle timestamptz)`;
    await sql`INSERT INTO app_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;
    // Liderlik takibi: mevcut lider ve ne zamandan beri lider oldugu.
    await sql`ALTER TABLE app_state ADD COLUMN IF NOT EXISTS leader_id bigint`;
    await sql`ALTER TABLE app_state ADD COLUMN IF NOT EXISTS leader_since timestamptz`;
    // Her oyuncunun TOPLAM liderlik suresi (milisaniye; gecmis tum donemler dahil).
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS leader_ms bigint NOT NULL DEFAULT 0`;
    // Maca ait "Saha Raporu" (AI ile sunucuda uretilip yazilir).
    await sql`ALTER TABLE matches ADD COLUMN IF NOT EXISTS report jsonb`;
    await sql`ALTER TABLE matches ADD COLUMN IF NOT EXISTS report_at timestamptz`;
    // AI rapor uretimi icin kilit (ayni anda cift uretimi engeller).
    await sql`ALTER TABLE app_state ADD COLUMN IF NOT EXISTS report_lock timestamptz`;
    // Canli skor icin PAYLASIMLI onbellek (kisi bazli degil): 10 sn TTL + kilit.
    await sql`ALTER TABLE app_state ADD COLUMN IF NOT EXISTS live_scores jsonb`;
    await sql`ALTER TABLE app_state ADD COLUMN IF NOT EXISTS live_scores_at timestamptz`;
    await sql`ALTER TABLE app_state ADD COLUMN IF NOT EXISTS live_lock timestamptz`;
  })().catch((e) => {
    schemaReady = null;
    throw e;
  });
  return schemaReady;
}

module.exports = { sql, ensureAdmin, ensureSchema };
