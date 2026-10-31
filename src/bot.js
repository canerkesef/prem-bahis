'use strict';

// ============================================================
//  PREMİER LİG BOT
//  Yarışmaya bir "bot oyuncu" olarak katılır. YALNIZCA saha raporu ÜRETİLMİŞ
//  maçlara SABİT 100 ASCU yatırır (rapor maç günü gece 00:00'da üretilir; bot da
//  o an, güncel ihtimallere göre kupon yapar — geleceğe dönük erken bahis YOK).
//  Başlangıç bakiyesi gerçek oyuncularla aynıdır (START_BALANCE, varsayılan 12500).
//
//  SEÇİM (EN UYGUN BAHİS): Bot, TÜM pazarları birlikte değerlendirir — maç sonucu,
//  çifte şans, handikap, toplam/takım alt-üst, KG, kombinasyonlar, ilk yarı, ikinci
//  yarı, hangi yarıda daha çok gol — ve aralarından EN YÜKSEK ihtimalli (en düşük
//  oranlı) seçimi oynar. Neredeyse kesin/değersiz bahisler (oran < BOT_MIN_ODD, ör.
//  "Toplam 0.5 Üst", "Çifte Şans") elenir; böylece seçim anlamlı ve çeşitli kalır.
//  Bu seçim raporun "Sonuç" kısmı olarak yazılır (generateReportFor) ve report.pick
//  olarak damgalanır; bot tam da onu oynar. Seçim DETERMİNİSTİKtir.
//
//  botSync(): bot kullanıcısını oluşturur (yoksa) ve bot kuponu olmayan tüm
//  maçlara kuponunu yerleştirir. Maç zaten sonuçlanmışsa kuponu anında
//  notlandırır (geriye dönük), açık maçta bekleyen kupon bırakır (normal
//  sonuçlandırma akışı daha sonra notlandırır). İşlem idempotenttir.
// ============================================================

const { sql } = require('./db');
const bcrypt = require('bcryptjs');
const { isWinner, halfMoreWinner } = require('./settle');

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

// Bot TÜM pazarları değerlendirir ve maça EN UYGUN (en yüksek ihtimalli) bahsi seçer.
// Anahtarlar markets/settle ile BİREBİR aynı olmalı. Sıra = eşit oranda öncelik (tie-break).
const BOT_CANDIDATES = [
  // Maç sonucu
  ['1x2', '1', 'Ev Sahibi Galibiyeti'], ['1x2', 'X', 'Beraberlik'], ['1x2', '2', 'Deplasman Galibiyeti'],
  // Not: Çifte Şans (dc), Handikap (çifte-şans eşdeğeri) ve Toplam 0.5 Üst gibi "yapısı gereği
  // güvenli" bahisler bot adaylarına ALINMADI (insan oyuncular için pazarlar durur).
  // Diğer neredeyse-kesin bahisler BOT_MIN_ODD tabanıyla elenir.
  // Toplam gol
  ['ou15', 'over', '1.5 Üst'], ['ou15', 'under', '1.5 Alt'],
  ['ou25', 'over', '2.5 Üst'], ['ou25', 'under', '2.5 Alt'],
  ['ou35', 'over', '3.5 Üst'], ['ou35', 'under', '3.5 Alt'],
  ['oe', 'odd', 'Toplam Gol Tek'], ['oe', 'even', 'Toplam Gol Çift'],
  ['btts', 'yes', 'Karşılıklı Gol Var'], ['btts', 'no', 'Karşılıklı Gol Yok'],
  ['goals_band', '0-1', 'Toplam 0-1 Gol'], ['goals_band', '2-3', 'Toplam 2-3 Gol'],
  ['goals_band', '4-5', 'Toplam 4-5 Gol'], ['goals_band', '6+', 'Toplam 6+ Gol'],
  // Takım golleri
  ['h_ou05', 'over', 'Ev Sahibi 0.5 Üst'], ['h_ou15', 'over', 'Ev Sahibi 1.5 Üst'], ['h_ou25', 'over', 'Ev Sahibi 2.5 Üst'],
  ['h_ou15', 'under', 'Ev Sahibi 1.5 Alt'], ['h_ou25', 'under', 'Ev Sahibi 2.5 Alt'],
  ['a_ou05', 'over', 'Deplasman 0.5 Üst'], ['a_ou15', 'over', 'Deplasman 1.5 Üst'], ['a_ou25', 'over', 'Deplasman 2.5 Üst'],
  ['a_ou15', 'under', 'Deplasman 1.5 Alt'], ['a_ou25', 'under', 'Deplasman 2.5 Alt'],
  // Kombinasyonlar
  ['ms_ou25', '1-ust', 'Ev & 2.5 Üst'], ['ms_ou25', '1-alt', 'Ev & 2.5 Alt'],
  ['ms_ou25', 'X-ust', 'Beraberlik & 2.5 Üst'], ['ms_ou25', 'X-alt', 'Beraberlik & 2.5 Alt'],
  ['ms_ou25', '2-ust', 'Deplasman & 2.5 Üst'], ['ms_ou25', '2-alt', 'Deplasman & 2.5 Alt'],
  ['ms_btts', '1-var', 'Ev & KG Var'], ['ms_btts', '2-var', 'Deplasman & KG Var'],
  ['btts_ou25', 'var-ust', 'KG Var & 2.5 Üst'], ['btts_ou25', 'var-alt', 'KG Var & 2.5 Alt'],
  ['btts_ou25', 'yok-ust', 'KG Yok & 2.5 Üst'], ['btts_ou25', 'yok-alt', 'KG Yok & 2.5 Alt'],
  // İlk yarı
  ['iy_1x2', '1', 'İlk Yarı Ev'], ['iy_1x2', 'X', 'İlk Yarı Beraberlik'], ['iy_1x2', '2', 'İlk Yarı Deplasman'],
  ['iy_ou05', 'over', 'İlk Yarı 0.5 Üst'], ['iy_ou05', 'under', 'İlk Yarı 0.5 Alt'],
  ['iy_ou15', 'over', 'İlk Yarı 1.5 Üst'], ['iy_ou15', 'under', 'İlk Yarı 1.5 Alt'],
  ['iy_btts', 'yes', 'İlk Yarı KG Var'], ['iy_btts', 'no', 'İlk Yarı KG Yok'],
  // İkinci yarı
  ['sh_1x2', '1', 'İkinci Yarı Ev'], ['sh_1x2', 'X', 'İkinci Yarı Beraberlik'], ['sh_1x2', '2', 'İkinci Yarı Deplasman'],
  ['sh_ou05', 'over', 'İkinci Yarı 0.5 Üst'], ['sh_ou05', 'under', 'İkinci Yarı 0.5 Alt'],
  ['sh_ou15', 'over', 'İkinci Yarı 1.5 Üst'], ['sh_ou15', 'under', 'İkinci Yarı 1.5 Alt'],
  ['sh_btts', 'yes', 'İkinci Yarı KG Var'], ['sh_btts', 'no', 'İkinci Yarı KG Yok'],
  // Hangi yarıda daha çok gol
  ['half_more_h', '1y', 'Ev Sahibi Golü İlk Yarı'], ['half_more_h', '2y', 'Ev Sahibi Golü İkinci Yarı'], ['half_more_h', 'esit', 'Ev Sahibi Yarılar Eşit'],
  ['half_more_a', '1y', 'Deplasman Golü İlk Yarı'], ['half_more_a', '2y', 'Deplasman Golü İkinci Yarı'], ['half_more_a', 'esit', 'Deplasman Yarılar Eşit'],
  ['half_more_t', '1y', 'Çok Gol İlk Yarı'], ['half_more_t', '2y', 'Çok Gol İkinci Yarı'], ['half_more_t', 'esit', 'Yarılar Eşit Gol'],
];

// Neredeyse kesin/değersiz bahisleri eler: oranı bu tabanın ALTINDA olan adaylar
// değerlendirmeye alınmaz (ör. "Toplam 0.5 Üst", "Çifte Şans"). Böylece en yüksek
// ihtimal yine seçilir ama anlamlı/çeşitli kalır. Env ile ayarlanabilir.
const BOT_MIN_ODD = Number(process.env.BOT_MIN_ODD || 1.25);

// EN UYGUN BAHİS: tüm aday pazarlar arasında, oran tabanını geçenler içinden EN DÜŞÜK
// oranlı (en yüksek ihtimalli) seçimi döndürür. Oranlar aynı Poisson modelinden geldiği
// için pazarlar arası karşılaştırma tutarlıdır. Döner: {market, selection, odd, label, prob}.
function bestPick(markets) {
  const mk = parseMk(markets);
  if (!mk) return null;
  let best = null;        // tabanı geçen en iyi
  let fallback = null;    // hiçbiri tabanı geçmezse: genel en düşük oran
  BOT_CANDIDATES.forEach(([market, selection, label]) => {
    const o = mk[market] && num(mk[market][selection]);
    if (!o) return;
    if (!fallback || o < fallback.odd - 1e-9) fallback = { market, selection, odd: o, label };
    if (o < BOT_MIN_ODD) return; // değersiz/kesin bahis -> ele
    if (!best || o < best.odd - 1e-9) best = { market, selection, odd: o, label };
  });
  const pick = best || fallback;
  if (!pick) return null;
  return {
    market: pick.market, selection: pick.selection, odd: pick.odd,
    label: pick.label, prob: Math.round(100 / pick.odd), src: 'en-iyi-ihtimal',
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
  // settle.js ile AYNI mantık: yarı-bağımlı pazarlar (iy_/sh_/half_more_) devre skoru ister.
  if (match.status === 'settled'
      && Number.isInteger(match.home_score) && Number.isInteger(match.away_score)) {
    const ftH = match.home_score, ftA = match.away_score;
    const htH = match.ht_home, htA = match.ht_away;
    const haveHT = Number.isInteger(htH) && Number.isInteger(htA);
    const m = pick.market;
    const needsHT = m.startsWith('iy_') || m.startsWith('sh_') || m.startsWith('half_more_');
    if (needsHT && !haveHT) {
      // Devre skoru yok -> yarı bahsi iade (void); applyHalfTime gelince yeniden hesaplanır.
      await tx`UPDATE coupons SET status='void', settled_at=now() WHERE id=${c.id}`;
      await tx`UPDATE users SET balance = balance + ${BOT_STAKE} WHERE id=${botId}`;
    } else {
      const won = m.startsWith('half_more_')
        ? halfMoreWinner(m, pick.selection, htH, htA, ftH, ftA)
        : m.startsWith('sh_')
          ? isWinner(m.slice(3), pick.selection, ftH - htH, ftA - htA)
          : m.startsWith('iy_')
            ? isWinner(m, pick.selection, htH, htA)
            : isWinner(m, pick.selection, ftH, ftA);
      if (won) {
        await tx`UPDATE coupons SET status='won', settled_at=now() WHERE id=${c.id}`;
        await tx`UPDATE users SET balance = balance + ${potential} WHERE id=${botId}`;
      } else {
        await tx`UPDATE coupons SET status='lost', settled_at=now() WHERE id=${c.id}`;
      }
    }
  } else if (match.status === 'void') {
    await tx`UPDATE coupons SET status='void', settled_at=now() WHERE id=${c.id}`;
    await tx`UPDATE users SET balance = balance + ${BOT_STAKE} WHERE id=${botId}`;
  }
  return true;
}

// Botu senkronize eder. KURAL: bot SADECE saha raporu ÜRETİLMİŞ maçlara kupon yapar
// (raporu maç günü gece 00:00'da üretildiği için bot da o an kupon oluşturur —
// geleceğe/erken bahis YOK; ihtimaller, sakatlıklar değişebileceği için).
//
//  - rebuild=true: botun TÜM kuponlarını siler, bakiyeyi başlangıca sıfırlar ve
//    yalnızca raporu olan maçlara yeniden kurar (yanlış/erken geçmişi temizlemek için;
//    admin düğmesi bunu çağırır). Geçmiş (sonuçlanmış) raporlu maçlar anında notlanır.
//  - rebuild=false (otomatik akışlar): raporu OLMAYAN maçlardaki BEKLEYEN bot kuponlarını
//    siler + iade eder (erken bahisleri toplar) ve raporu olup bot kuponu olmayan maçlara
//    kuponunu ekler. İdempotent.
async function botSync(opts = {}) {
  const rebuild = opts.rebuild === true;
  const bot = await ensureBot();

  if (rebuild) {
    await sql.begin(async (tx) => {
      await tx`DELETE FROM coupons WHERE user_id=${bot.id}`;
      await tx`UPDATE users SET balance=${START_BALANCE}, eliminated=false WHERE id=${bot.id}`;
    });
    bot.balance = START_BALANCE;
  }

  // TEMİZLİK: raporu OLMAYAN maçlardaki bekleyen bot kuponlarını sil + bahsi iade et
  // (eski sürümün geleceğe/erken açtığı bahisler buradan toplanır).
  let removed = 0;
  await sql.begin(async (tx) => {
    const stray = await tx`
      SELECT c.id, c.stake FROM coupons c
      JOIN matches m ON m.id=c.match_id
      WHERE c.user_id=${bot.id} AND c.status='pending' AND m.report IS NULL`;
    for (const c of stray) {
      await tx`DELETE FROM coupons WHERE id=${c.id}`;
      await tx`UPDATE users SET balance = balance + ${c.stake} WHERE id=${bot.id}`;
      removed++;
    }
  });

  // YERLEŞTİR: YALNIZCA raporu olan maçlar. Bot kuponu yoksa ekle.
  const matches = await sql`
    SELECT id, home_team, away_team, commence_time, status, home_score, away_score, ht_home, ht_away, markets, report
    FROM matches WHERE report IS NOT NULL ORDER BY commence_time ASC`;
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
  // Teşhis: raporu olan maç sayısı + botun toplam kupon/bakiye durumu.
  const [rc] = await sql`SELECT COUNT(*)::int AS n FROM matches WHERE report IS NOT NULL`;
  const [bc] = await sql`SELECT COUNT(*)::int AS n FROM coupons WHERE user_id=${bot.id}`;
  const [bb] = await sql`SELECT balance FROM users WHERE id=${bot.id}`;
  return {
    ok: true, placed, graded, removed, rebuilt: rebuild, botId: bot.id,
    reportedMatches: rc ? rc.n : 0, botCoupons: bc ? bc.n : 0, botBalance: bb ? Number(bb.balance) : null,
  };
}

module.exports = { botSync, ensureBot, derivePick, bestPick, BOT_NAME };
