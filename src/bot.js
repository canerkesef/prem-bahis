'use strict';

// ============================================================
//  PREMİER LİG BOT
//  Yarışmaya bir "bot oyuncu" olarak katılır. Ligin başından itibaren
//  HER maça SABİT 100 ASCU yatırır. Başlangıç bakiyesi gerçek oyuncularla
//  aynıdır (START_BALANCE, varsayılan 12500).
//
//  SEÇİM: Botun kuponu, maçın "Saha Raporu"nun SONUÇ kısmından türetilir.
//  conclusion.title serbest metin olduğundan (ör. "Ev Sahibi Favori",
//  "Gollü Maç", "Karşılıklı Gol") metin ayrıştırılıp oynanabilir bir
//  pazar+seçime çevrilir (1X2 / 2.5 Alt-Üst / KG). Rapor yoksa ya da metin
//  çözülemezse 1X2'de en düşük oranlı sonuca (favori) düşülür — bu da zaten
//  raporun oran bazlı sonucudur. Seçim DETERMİNİSTİKtir.
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

// Türkçe metni sadeleştir (küçük harf + aksan kaldır) -> anahtar kelime eşleşmesi için.
function norm(s) {
  const map = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'İ': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u' };
  return String(s || '').toLocaleLowerCase('tr-TR').replace(/[çğıİöşüâîû]/g, (c) => map[c] || c);
}

// 1X2'de en düşük oranlı sonuç (favori). Raporun oran bazlı sonucuna karşılık gelir.
function oddsFavorite(mk) {
  const m = mk && mk['1x2'];
  if (!m) return null;
  const opts = [['1', num(m['1'])], ['X', num(m.X)], ['2', num(m['2'])]].filter(([, o]) => o);
  if (!opts.length) return null;
  opts.sort((a, b) => a[1] - b[1]);
  const [sel, odd] = opts[0];
  const label = sel === '1' ? 'Ev Sahibi Kazanır' : sel === '2' ? 'Deplasman Kazanır' : 'Beraberlik';
  return { market: '1x2', selection: sel, odd, label, src: 'oran' };
}

// Rapor sonucu metnini (conclusion.title) oynanabilir pazar+seçime çevirir.
// Seçimin oranı markets içinde yoksa null döner (çağıran favoriye düşer).
function parseConclusion(title, match, mk) {
  const t = norm(title);
  if (!t) return null;
  const home = norm(match.home_team), away = norm(match.away_team);
  const has = (...ws) => ws.some((w) => t.includes(norm(w)));
  // Seçim oranı varsa paketle.
  const make = (market, selection, label, src) => {
    const o = mk[market] && num(mk[market][selection]);
    return o ? { market, selection, odd: o, label, src } : null;
  };
  // Olumsuzlama: "ev sahibi favori değil" gibi -> yön ters çevrilmesin, atla.
  const negated = has('degil', 'zor', 'surpriz');

  // Kazananı belirten ifadeler (maç sonucu = birincil yorum).
  const homeWin = !negated && (
    has('ev sahibi favori', 'ev sahibi kazan', 'ev sahibi ustun', 'ev sahibi galib', 'ev sahibi onde', 'ev favori', 'ic saha')
    || (home && home.length > 2 && t.includes(home) && has('favori', 'kazan', 'ustun', 'galib', 'onde'))
  );
  const awayWin = !negated && (
    has('deplasman favori', 'deplasman kazan', 'deplasman ustun', 'deplasman galib', 'deplasman onde', 'dep favori', 'dis saha')
    || (away && away.length > 2 && t.includes(away) && has('favori', 'kazan', 'ustun', 'galib', 'onde'))
  );
  const draw = has('beraberlik', 'berabere', 'gol paylas', 'puan paylas', 'esitlik', 'baraj', 'denk guc');

  // Gol beklentisi. "az gol(lü)" hem alt hem üst anahtarı içerebildiğinden alt önceliklidir.
  // Tek başına "üst/alt" sıralama anlamına da gelebildiği için kullanılmaz; net ifade aranır.
  const under = has('az gol', 'gol az', 'dusuk skor', '2.5 alt', 'kisir', 'temkinli', 'kapali mac', 'cekingen');
  const over = !under && has('gollu', 'bol gol', 'cok gol', '2.5 ust', 'gol duello', 'gol yagmur', 'acik mac', 'gol sans');

  // Karşılıklı gol.
  const bttsYes = has('karsilikli gol', 'kg var', 'iki takim da gol', 'iki taraf gol');
  const bttsNo = has('kg yok', 'tek taraf');

  // Öncelik: net kazanan > beraberlik > gol üst/alt > KG.
  let p = null;
  if (homeWin && !awayWin) p = make('1x2', '1', 'Ev Sahibi Kazanır', 'rapor');
  else if (awayWin && !homeWin) p = make('1x2', '2', 'Deplasman Kazanır', 'rapor');
  if (!p && draw) p = make('1x2', 'X', 'Beraberlik', 'rapor');
  if (!p && over && !under) p = make('ou25', 'ust', '2.5 Üst', 'rapor');
  if (!p && under && !over) p = make('ou25', 'alt', '2.5 Alt', 'rapor');
  if (!p && bttsYes && !bttsNo) p = make('btts', 'yes', 'KG Var', 'rapor');
  if (!p && bttsNo && !bttsYes) p = make('btts', 'no', 'KG Yok', 'rapor');
  return p;
}

// Nihai bot seçimi: önce rapora kayıtlı yapısal pick, sonra sonuç metnini ayrıştır,
// sonra 1X2 oran favorisi.
function derivePick(report, match, markets) {
  const mk = parseMk(markets);
  if (!mk) return null;
  // Rapor üretiminde damgalanmış hazır pick (oranı hâlâ geçerliyse kullan).
  if (report && report.pick && report.pick.market && report.pick.selection) {
    const o = mk[report.pick.market] && num(mk[report.pick.market][report.pick.selection]);
    if (o) return { market: report.pick.market, selection: report.pick.selection, odd: o, label: report.pick.label || '', src: report.pick.src || 'rapor' };
  }
  const title = report && report.conclusion && report.conclusion.title;
  const parsed = title ? parseConclusion(title, match, mk) : null;
  return parsed || oddsFavorite(mk);
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

module.exports = { botSync, ensureBot, derivePick, parseConclusion, oddsFavorite, BOT_NAME };
