'use strict';

// ============================================================
//  PREMİER LİG BOT
//  Yarışmaya bir "bot oyuncu" olarak katılır. Ligin başından itibaren
//  HER maça SABİT 100 ASCU yatırır. Başlangıç bakiyesi gerçek oyuncularla
//  aynıdır (START_BALANCE, varsayılan 12500).
//
//  SEÇİM (EN İYİ İHTİMAL): Bot, ÇEKİRDEK kriterleri birlikte değerlendirir —
//  maç sonucu (1X2), 2.5 Alt/Üst, karşılıklı gol (KG) — ve bunların arasından
//  EN DÜŞÜK oranlı (= en yüksek ihtimalli, en tutarlı) seçimi oynar. Yani illa
//  1-X-2 değil; alt/üst ya da KG de olabilir. Bu seçim aynı zamanda raporun
//  "Sonuç" kısmı olarak yazılır (generateReportFor). Seçim DETERMİNİSTİKtir ve
//  rapor üretiminde report.pick olarak damgalanır; bot tam da onu oynar.
//
//  botSync(): bot kullanıcısını oluşturur (yoksa) ve bot kuponu olmayan tüm
//  maçlara kuponunu yerleştirir. Maç zaten sonuçlanmışsa kuponu anında
//  notlandırır (geriye dönük), açık maçta bekleyen kupon bırakır (normal
//  sonuçlandırma akışı daha sonra notlandırır). İşlem idempotenttir.
// ============================================================

const { sql } = require('./db');
const bcrypt = require('bcryptjs');
const { isWinner } = require('./settle');

const BOT_NAME = process.env.BOT_NAME || 'PREMİER LİG BOT';
const BOT_STAKE = Number(process.env.BOT_STAKE || 100);
const MIN_STAKE = Number(process.env.MIN_STAKE || 50);
// Gerçek oyuncularla aynı başlangıç bakiyesi (env yoksa 12500).
const START_BALANCE = Number(process.env.START_BALANCE || 12500);

function num(x) { const n = Number(x); return Number.isFinite(n) && n > 0 ? n : null; }

// markets jsonb hem obje hem string gelebilir -> güvenli çöz.
function parseMk(m) {
  if (!m) return null;
  if (typeof m === 'string') { try { return JSON.parse(m); } catch { return null; } }
  return m;
}

// Botun değerlendirdiği ÇEKİRDEK kriterler: maç sonucu (1X2), 2.5 gol (Alt/Üst),
// karşılıklı gol (KG). Anahtarlar markets/settle ile BİREBİR aynı olmalı:
// 1x2 -> '1'|'X'|'2', ou25 -> 'over'|'under', btts -> 'yes'|'no'.
// Her adaya bir öncelik indeksi verilir (eşit oranda deterministik sıralama için).
const BOT_CANDIDATES = [
  ['1x2', '1', 'Ev Sahibi Galibiyeti'],
  ['1x2', 'X', 'Beraberlik'],
  ['1x2', '2', 'Deplasman Galibiyeti'],
  ['ou25', 'over', '2.5 Üst'],
  ['ou25', 'under', '2.5 Alt'],
  ['btts', 'yes', 'Karşılıklı Gol Var'],
  ['btts', 'no', 'Karşılıklı Gol Yok'],
];

// EN İYİ İHTİMAL: çekirdek kriterler arasında EN DÜŞÜK oranlı (en yüksek ihtimalli)
// seçimi döndürür. Oranlar aynı Poisson modelinden geldiği için pazarlar arası
// karşılaştırma tutarlıdır. Döner: {market, selection, odd, label, prob}.
function bestPick(markets) {
  const mk = parseMk(markets);
  if (!mk) return null;
  let best = null;
  BOT_CANDIDATES.forEach(([market, selection, label], idx) => {
    const o = mk[market] && num(mk[market][selection]);
    if (!o) return;
    if (!best || o < best.odd - 1e-9) best = { market, selection, odd: o, label, idx };
  });
  if (!best) return null;
  return {
    market: best.market, selection: best.selection, odd: best.odd,
    label: best.label, prob: Math.round(100 / best.odd), src: 'en-iyi-ihtimal',
  };
}

// Nihai bot seçimi: rapora damgalanmış pick (oranı geçerliyse) ya da anlık en iyi ihtimal.
// İkisi de aynı deterministik hesaptan geldiği için sonuç tutarlıdır.
function derivePick(report, match, markets) {
  const mk = parseMk(markets);
  if (!mk) return null;
  if (report && report.pick && report.pick.market && report.pick.selection) {
    const o = mk[report.pick.market] && num(mk[report.pick.market][report.pick.selection]);
    if (o) return {
      market: report.pick.market, selection: report.pick.selection, odd: o,
      label: report.pick.label || '', prob: report.pick.prob || Math.round(100 / o),
      src: report.pick.src || 'en-iyi-ihtimal',
    };
  }
  return bestPick(mk);
}

// Bot kullanıcısını garanti eder (yoksa oluşturur). Bot giriş yapamaz:
// rastgele, kimsenin bilmediği bir parola hash'i ile oluşturulur.
async function ensureBot() {
  const rows = await sql`SELECT id, balance FROM users WHERE username=${BOT_NAME}`;
  if (rows.length) return { id: Number(rows[0].id), balance: Number(rows[0].balance) };
  const hash = bcrypt.hashSync('bot-' + Math.random().toString(36).slice(2) + '-' + Date.now(), 10);
  const ins = await sql`
    INSERT INTO users (username, password_hash, is_admin, status, balance, is_bot)
    VALUES (${BOT_NAME}, ${hash}, false, 'approved', ${START_BALANCE}, true)
    ON CONFLICT (username) DO UPDATE SET status='approved', is_bot=true
    RETURNING id, balance`;
  return { id: Number(ins[0].id), balance: Number(ins[0].balance) };
}

// Tek bir maç için (transaction içinde) bot kuponunu oluşturur.
// Zaten kupon varsa veya seçim türetilemiyorsa atlar. Maç sonuçlanmış/iptalse
// anında notlandırır. Döner: kupon yerleştirildi mi.
async function botBetMatchTx(tx, botId, match) {
  const [ex] = await tx`SELECT 1 FROM coupons WHERE user_id=${botId} AND match_id=${match.id} LIMIT 1`;
  if (ex) return false;
  const pick = derivePick(match.report, match, match.markets);
  if (!pick) return false;
  const [bal] = await tx`SELECT balance FROM users WHERE id=${botId} FOR UPDATE`;
  if (Number(bal.balance) < BOT_STAKE) return false; // bot iflas etti -> bahis yok
  const potential = Math.round(BOT_STAKE * pick.odd * 100) / 100;
  const [c] = await tx`
    INSERT INTO coupons (user_id, match_id, home_team, away_team, commence_time,
      market, selection, odd, stake, potential_win, status)
    VALUES (${botId}, ${match.id}, ${match.home_team}, ${match.away_team}, ${match.commence_time},
      ${pick.market}, ${pick.selection}, ${pick.odd}, ${BOT_STAKE}, ${potential}, 'pending')
    RETURNING id`;
  await tx`UPDATE users SET balance = balance - ${BOT_STAKE} WHERE id=${botId}`;

  // Maç zaten kapandıysa kuponu anında notlandır (geriye dönük simülasyon).
  if (match.status === 'settled'
      && Number.isInteger(match.home_score) && Number.isInteger(match.away_score)) {
    const won = isWinner(pick.market, pick.selection, match.home_score, match.away_score);
    if (won) {
      await tx`UPDATE coupons SET status='won', settled_at=now() WHERE id=${c.id}`;
      await tx`UPDATE users SET balance = balance + ${potential} WHERE id=${botId}`;
    } else {
      await tx`UPDATE coupons SET status='lost', settled_at=now() WHERE id=${c.id}`;
    }
  } else if (match.status === 'void') {
    await tx`UPDATE coupons SET status='void', settled_at=now() WHERE id=${c.id}`;
    await tx`UPDATE users SET balance = balance + ${BOT_STAKE} WHERE id=${botId}`;
  }
  return true;
}

// Botu tüm maçlara göre senkronize eder (geriye dönük + açık maçlar).
// Her maç kendi transaction'ında işlenir (idempotent, kısmi başarı güvenli).
async function botSync() {
  const bot = await ensureBot();
  const matches = await sql`
    SELECT id, home_team, away_team, commence_time, status, home_score, away_score, markets, report
    FROM matches ORDER BY commence_time ASC`;
  let placed = 0, graded = 0;
  for (const m of matches) {
    try {
      await sql.begin(async (tx) => {
        const did = await botBetMatchTx(tx, bot.id, m);
        if (did) { placed++; if (m.status !== 'open') graded++; }
      });
    } catch (e) {
      console.error('[bot] mac senkron hatasi', m.id, e.message);
    }
  }
  // Bot iflas ettiyse elenme bayrağını güncelle (KURAL 13 ile uyumlu).
  await sql`
    UPDATE users u SET eliminated =
      (u.balance < ${MIN_STAKE} AND NOT EXISTS (
        SELECT 1 FROM coupons c WHERE c.user_id=u.id AND c.status='pending'))
    WHERE u.id=${bot.id}`;
  return { ok: true, placed, graded, botId: bot.id };
}

module.exports = { botSync, ensureBot, derivePick, bestPick, BOT_NAME };
