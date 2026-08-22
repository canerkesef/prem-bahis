'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');

const { sql, ensureAdmin, ensureSchema } = require('../src/db');
const { seedSampleMatches } = require('../src/seed');
const { refreshMatches, refreshResults, hasApi, fetchStandings } = require('../src/oddsApi');
const { settleMatch, voidMatch, applyHalfTime } = require('../src/settle');
const { computeMarkets } = require('../src/odds-derive');

const app = express();
const SECRET = process.env.SESSION_SECRET || 'lutfen-bu-anahtari-degistir';
const START_BALANCE = Number(process.env.START_BALANCE || 1000);
// KURAL 1: Her maca en az bu kadar ASCU ile kupon yapilabilir.
const MIN_STAKE = Number(process.env.MIN_STAKE || 50);
// KURAL 2: Turnuva bu tarihte biter; bu andan sonra yeni kupon yapilamaz.
const TOURNAMENT_END = process.env.TOURNAMENT_END || '2027-01-01T00:00:00+03:00';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

app.set('trust proxy', 1);
app.use(express.json());
app.use(cookieParser(SECRET));

// -------- Baslangic (instance basina bir kez) --------
let initPromise = null;
async function init() {
  await ensureSchema();
  await ensureAdmin();
  if (!hasApi()) await seedSampleMatches();
}
// Statik arayuz her zaman yuklenir (veritabani gerektirmez).
app.use(express.static(PUBLIC_DIR));

// Veritabani hazirligi YALNIZCA API istekleri icin gerekli.
// Boylece veritabani gecici olarak kapaliysa bile site acilir, sadece veri gelmez.
app.use('/api', async (req, res, next) => {
  try {
    if (!initPromise) initPromise = init();
    await initPromise;
    next();
  } catch (e) {
    initPromise = null;
    console.error('[init] hata:', e.message);
    res.status(503).json({ error: 'Veritabanina su an ulasilamiyor, lutfen biraz sonra tekrar deneyin.' });
  }
});

// -------- Yardimcilar --------
async function currentUser(req) {
  const uid = req.signedCookies && req.signedCookies.uid;
  if (!uid) return null;
  const rows = await sql`SELECT id, username, is_admin, status, balance, eliminated FROM users WHERE id=${Number(uid)}`;
  return rows[0] || null;
}
async function requireAuth(req, res, next) {
  try {
    const u = await currentUser(req);
    if (!u) return res.status(401).json({ error: 'Giris yapmalisiniz.' });
    if (u.status !== 'approved') return res.status(403).json({ error: 'Hesabiniz henuz onaylanmadi.' });
    req.user = { id: Number(u.id), username: u.username, is_admin: !!u.is_admin, balance: Number(u.balance), eliminated: !!u.eliminated };
    next();
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user.is_admin) return res.status(403).json({ error: 'Yetkiniz yok.' });
    next();
  });
}
function setLoginCookie(res, id) {
  res.cookie('uid', String(id), {
    httpOnly: true,
    signed: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

// Bahis pazarlari artik her mac icin markets (jsonb) icinde tutuluyor.

// ================= AUTH =================
app.post('/api/register', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (username.length < 3) return res.status(400).json({ error: 'Kullanici adi en az 3 karakter olmali.' });
    if (password.length < 4) return res.status(400).json({ error: 'Sifre en az 4 karakter olmali.' });
    const exists = await sql`SELECT id FROM users WHERE username=${username}`;
    if (exists.length) return res.status(409).json({ error: 'Bu kullanici adi zaten alinmis.' });
    const hash = bcrypt.hashSync(password, 10);
    await sql`INSERT INTO users (username, password_hash, status, balance)
              VALUES (${username}, ${hash}, 'pending', ${START_BALANCE})`;
    res.json({ ok: true, message: 'Kayit alindi. Admin onayindan sonra giris yapabilirsiniz.' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const rows = await sql`SELECT * FROM users WHERE username=${username}`;
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Kullanici adi veya sifre hatali.' });
    }
    if (user.status === 'pending') return res.status(403).json({ error: 'Hesabiniz henuz admin tarafindan onaylanmadi.' });
    if (user.status === 'rejected') return res.status(403).json({ error: 'Hesabiniz reddedilmis.' });
    setLoginCookie(res, user.id);
    res.json({ ok: true, user: { id: Number(user.id), username: user.username, is_admin: !!user.is_admin, balance: Number(user.balance) } });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('uid');
  res.json({ ok: true });
});

app.get('/api/me', async (req, res) => {
  try {
    const u = await currentUser(req);
    const config = { min_stake: MIN_STAKE, tournament_end: TOURNAMENT_END, no_bet_penalty: Number(process.env.NO_BET_PENALTY || 100) };
    if (!u) return res.json({ user: null, config });
    res.json({ user: { id: Number(u.id), username: u.username, is_admin: !!u.is_admin, status: u.status, balance: Number(u.balance), eliminated: !!u.eliminated }, config });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ================= MACLAR =================
function parseMarkets(v) {
  if (!v) return {};
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch (_) { return {}; }
  }
  return v;
}
function matchOut(m) {
  return {
    id: m.id,
    home_team: m.home_team,
    away_team: m.away_team,
    commence_time: m.commence_time,
    status: m.status,
    home_score: m.home_score,
    away_score: m.away_score,
    odds: parseMarkets(m.markets),
  };
}
function num(v) {
  return v == null ? null : Number(v);
}

app.get('/api/matches', requireAuth, async (req, res) => {
  try {
    const rows = await sql`SELECT * FROM matches WHERE status='open' ORDER BY commence_time ASC`;
    res.json({ matches: rows.map(matchOut) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Gercek Premier Lig puan durumu (football-data.org)
app.get('/api/standings', requireAuth, async (req, res) => {
  try {
    const r = await fetchStandings();
    if (!r.ok) return res.status(400).json(r);
    res.json(r);
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.get('/api/matches/results', requireAuth, async (req, res) => {
  try {
    const rows = await sql`SELECT * FROM matches WHERE status IN ('settled','void') ORDER BY commence_time DESC LIMIT 100`;
    res.json({ matches: rows.map(matchOut) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ================= KUPONLAR =================
app.post('/api/coupons', requireAuth, async (req, res) => {
  try {
    const matchId = String(req.body.match_id || '');
    const market = String(req.body.market || '');
    const selection = String(req.body.selection || '');
    const stake = Number(req.body.stake);

    if (!market || !selection) return res.status(400).json({ error: 'Gecersiz bahis secimi.' });
    if (!Number.isFinite(stake) || stake <= 0) return res.status(400).json({ error: 'Gecerli bir bahis tutari girin.' });
    // KURAL 13: Elenmis (Kaybetti) oyuncu yeni kupon yapamaz.
    if (req.user.eliminated) return res.status(400).json({ error: 'Bakiyeniz yetersiz kaldigi icin turnuvadan elendiniz (Kaybetti). Yeni kupon yapamazsiniz.' });
    // KURAL 2: Turnuva bittiyse yeni kupon yok.
    if (Date.now() >= new Date(TOURNAMENT_END).getTime()) {
      return res.status(400).json({ error: 'Turnuva sona erdi (1 Ocak). Yeni kupon yapilamaz.' });
    }
    // KURAL 1: Minimum kupon tutari.
    if (stake < MIN_STAKE) return res.status(400).json({ error: `Minimum kupon tutari ${MIN_STAKE} ASCU.` });

    const rows = await sql`SELECT * FROM matches WHERE id=${matchId} AND status='open'`;
    const match = rows[0];
    if (!match) return res.status(404).json({ error: 'Mac bulunamadi veya bahse kapali.' });
    if (new Date(match.commence_time).getTime() <= Date.now()) {
      return res.status(400).json({ error: 'Mac baslamis, bu maca kupon yapilamaz.' });
    }
    const mkts = parseMarkets(match.markets);
    const odd = num(mkts[market] && mkts[market][selection]);
    if (!odd) return res.status(400).json({ error: 'Bu secim icin oran mevcut degil.' });

    const potentialWin = Math.round(stake * odd * 100) / 100;

    // Bakiye dusme atomik: yeterli bakiye varsa dus, degilse 0 satir etkilenir.
    let ok = false;
    await sql.begin(async (tx) => {
      const upd = await tx`
        UPDATE users SET balance = balance - ${stake}
        WHERE id=${req.user.id} AND balance >= ${stake}
        RETURNING id`;
      if (upd.length === 0) return; // yetersiz bakiye
      ok = true;
      await tx`
        INSERT INTO coupons (user_id, match_id, home_team, away_team, commence_time,
          market, selection, odd, stake, potential_win)
        VALUES (${req.user.id}, ${match.id}, ${match.home_team}, ${match.away_team}, ${match.commence_time},
          ${market}, ${selection}, ${odd}, ${stake}, ${potentialWin})`;
    });
    if (!ok) return res.status(400).json({ error: 'Yetersiz bakiye.' });

    const brows = await sql`SELECT balance FROM users WHERE id=${req.user.id}`;
    res.json({ ok: true, balance: Number(brows[0].balance) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/coupons/mine', requireAuth, async (req, res) => {
  try {
    const rows = await sql`SELECT * FROM coupons WHERE user_id=${req.user.id} ORDER BY created_at DESC`;
    res.json({ coupons: rows.map(couponOut) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

function couponOut(c) {
  return {
    id: Number(c.id),
    match_id: c.match_id,
    home_team: c.home_team,
    away_team: c.away_team,
    commence_time: c.commence_time,
    market: c.market,
    selection: c.selection,
    odd: num(c.odd),
    stake: num(c.stake),
    potential_win: num(c.potential_win),
    status: c.status,
    home_score: c.home_score,
    away_score: c.away_score,
    created_at: c.created_at,
  };
}

// ================= KULLANICILAR =================
app.get('/api/users', requireAuth, async (req, res) => {
  try {
    const rows = await sql`SELECT id, username, is_admin, balance, eliminated FROM users WHERE status='approved' ORDER BY balance DESC`;
    res.json({ users: rows.map((u) => ({ id: Number(u.id), username: u.username, is_admin: !!u.is_admin, balance: Number(u.balance), eliminated: !!u.eliminated })) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/users/:id', requireAuth, async (req, res) => {
  try {
    const rows = await sql`SELECT id, username, is_admin, balance, eliminated, created_at FROM users WHERE id=${Number(req.params.id)} AND status='approved'`;
    const u = rows[0];
    if (!u) return res.status(404).json({ error: 'Kullanici bulunamadi.' });
    const coupons = (await sql`SELECT * FROM coupons WHERE user_id=${Number(u.id)} ORDER BY created_at DESC`).map(couponOut);
    const stats = coupons.reduce(
      (a, c) => {
        a.total++;
        if (c.status === 'won') a.won++;
        else if (c.status === 'lost') a.lost++;
        else if (c.status === 'pending') a.pending++;
        return a;
      },
      { total: 0, won: 0, lost: 0, pending: 0 }
    );
    res.json({ user: { id: Number(u.id), username: u.username, is_admin: !!u.is_admin, balance: Number(u.balance), eliminated: !!u.eliminated, created_at: u.created_at }, coupons, stats });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ================= ADMIN =================
app.get('/api/admin/pending', requireAdmin, async (req, res) => {
  try {
    const rows = await sql`SELECT id, username, created_at FROM users WHERE status='pending' ORDER BY created_at ASC`;
    res.json({ pending: rows.map((u) => ({ id: Number(u.id), username: u.username, created_at: u.created_at })) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/admin/users/:id/approve', requireAdmin, async (req, res) => {
  try { await sql`UPDATE users SET status='approved' WHERE id=${Number(req.params.id)}`; res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});
app.post('/api/admin/users/:id/reject', requireAdmin, async (req, res) => {
  try { await sql`UPDATE users SET status='rejected' WHERE id=${Number(req.params.id)}`; res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});
app.post('/api/admin/users/:id/balance', requireAdmin, async (req, res) => {
  try {
    const balance = Number(req.body.balance);
    if (!Number.isFinite(balance) || balance < 0) return res.status(400).json({ error: 'Gecersiz bakiye.' });
    await sql`UPDATE users SET balance=${balance} WHERE id=${Number(req.params.id)}`;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// Admin: sezonu sifirla — tum kuponlari sil, herkesin bakiyesini basa dondur
// (kullanici hesaplari SILINMEZ). Istege bagli: maclarin sonuclarini da temizle.
app.post('/api/admin/reset', requireAdmin, async (req, res) => {
  try {
    const alsoMatches = req.body && req.body.matches === true;
    await sql.begin(async (tx) => {
      await tx`DELETE FROM coupons`;
      await tx`UPDATE users SET balance = ${START_BALANCE}, eliminated = false`;
      if (alsoMatches) {
        await tx`UPDATE matches SET status='open', home_score=NULL, away_score=NULL WHERE status IN ('settled','void')`;
      }
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// Admin: kullaniciyi ve tum kuponlarini sil (kendi hesabini silemez)
app.post('/api/admin/users/:id/delete', requireAdmin, async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    if (targetId === req.user.id) return res.status(400).json({ error: 'Kendi hesabini silemezsin.' });
    const rows = await sql`SELECT id FROM users WHERE id=${targetId}`;
    if (rows.length === 0) return res.status(404).json({ error: 'Kullanici bulunamadi.' });
    await sql.begin(async (tx) => {
      await tx`DELETE FROM coupons WHERE user_id=${targetId}`;
      await tx`DELETE FROM users WHERE id=${targetId}`;
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.post('/api/admin/refresh-matches', requireAdmin, async (req, res) => {
  try {
    const r = await refreshMatches();
    if (!r.ok) return res.status(400).json(r);
    res.json(r);
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.post('/api/admin/refresh-results', requireAdmin, async (req, res) => {
  try {
    const r = await refreshResults(
      (id, h, a, htH, htA) => settleMatch(id, h, a, htH, htA),
      (id, htH, htA) => applyHalfTime(id, htH, htA)
    );
    if (!r.ok) return res.status(400).json(r);
    res.json(r);
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// Kullanim-tetiklemeli otomatik sonuclandirma (ucretsiz-guvenli):
// - Yalnizca bitmis ama sonuclanmamis / IY'si eksik mac varsa calisir.
// - Atomik kilit + soguma suresi ile ayni anda birden fazla calismayi engeller.
// - Sadece skor endpoint'ini kullanir (Odds API: 1 istek), gunluk limiti asmaz.
async function maybeAutoSettle() {
  const cd = Number(process.env.AUTO_SETTLE_COOLDOWN_MIN || 20);
  const work = await sql`
    SELECT 1 FROM matches
    WHERE (status='open' AND commence_time < now() - interval '2 hours')
       OR (status='settled' AND ht_home IS NULL)
    LIMIT 1`;
  if (!work.length) return { ran: false, reason: 'no-work' };
  const claim = await sql`
    UPDATE app_state SET last_auto_settle = now()
    WHERE id=1 AND (last_auto_settle IS NULL OR last_auto_settle < now() - (${cd} * interval '1 minute'))
    RETURNING id`;
  if (!claim.length) return { ran: false, reason: 'cooldown' };
  const r = await refreshResults(
    (id, h, a, htH, htA) => settleMatch(id, h, a, htH, htA),
    (id, htH, htA) => applyHalfTime(id, htH, htA)
  );
  return { ran: true, settled: r.settled || 0, iyFixed: r.iyFixed || 0 };
}

app.post('/api/auto-settle', requireAuth, async (req, res) => {
  try { res.json(await maybeAutoSettle()); }
  catch (e) { res.json({ ran: false, error: String(e.message || e) }); }
});

app.post('/api/admin/matches/:id/settle', requireAdmin, async (req, res) => {
  const h = Number(req.body.home_score);
  const a = Number(req.body.away_score);
  if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0) {
    return res.status(400).json({ error: 'Gecerli skor girin (0 veya uzeri tam sayi).' });
  }
  // Devre (ilk yari) skoru istege bagli; girilirse ilk yari kuponlari da hesaplanir.
  let htH = req.body.ht_home, htA = req.body.ht_away;
  htH = htH === '' || htH == null ? null : Number(htH);
  htA = htA === '' || htA == null ? null : Number(htA);
  const haveHT = Number.isInteger(htH) && Number.isInteger(htA);
  if (haveHT && (htH < 0 || htA < 0 || htH > h || htA > a)) {
    return res.status(400).json({ error: 'Devre skoru gecersiz (0+ ve mac sonu skorundan buyuk olamaz).' });
  }
  const correct = req.body.correct === true; // KURAL 8: yonetici duzeltmesi
  try { res.json(await settleMatch(req.params.id, h, a, haveHT ? htH : null, haveHT ? htA : null, { correct })); }
  catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

app.post('/api/admin/matches/:id/void', requireAdmin, async (req, res) => {
  try { res.json(await voidMatch(req.params.id)); }
  catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

app.post('/api/admin/matches', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const home = String(b.home_team || '').trim();
    const away = String(b.away_team || '').trim();
    const commence = String(b.commence_time || '').trim();
    if (!home || !away || !commence) return res.status(400).json({ error: 'Ev sahibi, deplasman ve tarih zorunlu.' });
    const id = 'manual-' + Date.now();
    const base = {
      odd_1: Number(b.odd_1) || null, odd_x: Number(b.odd_x) || null, odd_2: Number(b.odd_2) || null,
      odd_over: Number(b.odd_over) || null, odd_under: Number(b.odd_under) || null,
    };
    const markets = computeMarkets(base);
    if (!markets) return res.status(400).json({ error: 'En az 1, X, 2 oranlari gerekli.' });
    await sql`
      INSERT INTO matches (id, home_team, away_team, commence_time, status, markets)
      VALUES (${id}, ${home}, ${away}, ${commence}, 'open', ${JSON.stringify(markets)}::jsonb)`;
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// ================= CRON (Vercel gunluk otomatik guncelleme) =================
app.all('/api/cron/refresh', async (req, res) => {
  const secret = process.env.CRON_SECRET || '';
  if (!secret) return res.status(503).json({ error: 'CRON_SECRET tanimli degil.' });
  if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Yetkisiz.' });
  try {
    const m = await refreshMatches();
    const r = await refreshResults(
      (id, h, a, htH, htA) => settleMatch(id, h, a, htH, htA),
      (id, htH, htA) => applyHalfTime(id, htH, htA)
    );
    res.json({ ok: true, matches: m.count ?? null, settled: r.settled ?? null, iyFixed: r.iyFixed ?? null });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// Tum diger istekler -> arayuz
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Yerelde dogrudan calistirilinca dinle; Vercel'de app export edilir.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Prem Bahis calisiyor -> http://localhost:${PORT}`);
    console.log(hasApi() ? '[mod] Canli veri (The Odds API) aktif.' : '[mod] Ornek mac modu (API anahtari yok).');
  });
}

module.exports = app;
