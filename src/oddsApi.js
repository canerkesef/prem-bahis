'use strict';

// The Odds API (https://the-odds-api.com) uzerinden Premier Lig
// maclari, oranlari ve sonuclari cekilir. Ucretsiz plan aylik ~500 istek.
const { sql } = require('./db');
const { computeMarkets } = require('./odds-derive');

const SPORT = 'soccer_epl';
const BASE = 'https://api.the-odds-api.com/v4';

function apiKey() {
  return (process.env.ODDS_API_KEY || '').trim();
}
function region() {
  return (process.env.ODDS_REGION || 'eu').trim();
}
function hasApi() {
  return apiKey().length > 0;
}

// Bir cikti listesindeki (outcomes) fiyatlari bookmaker'lar arasi ortalar.
function collectPrices(bookmakers, marketKey, matcher) {
  const prices = [];
  for (const bk of bookmakers || []) {
    const market = (bk.markets || []).find((m) => m.key === marketKey);
    if (!market) continue;
    for (const oc of market.outcomes || []) {
      if (matcher(oc)) prices.push(oc.price);
    }
  }
  if (!prices.length) return null;
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  return Math.round(avg * 100) / 100;
}

// Maclari ve oranlari ceker, DB'ye yazar. Kac mac guncellendigini dondurur.
async function refreshMatches() {
  if (!hasApi()) {
    return { ok: false, error: 'ODDS_API_KEY tanimli degil. Ornek maclar kullaniliyor.' };
  }
  const url =
    `${BASE}/sports/${SPORT}/odds/?apiKey=${apiKey()}` +
    `&regions=${region()}&markets=h2h,totals&oddsFormat=decimal&dateFormat=iso`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `The Odds API hatasi (${res.status}): ${body.slice(0, 200)}` };
  }
  const events = await res.json();

  let count = 0;
  for (const ev of events) {
    const home = ev.home_team;
    const away = ev.away_team;
    const bms = ev.bookmakers || [];
    const base = {
      odd_1: collectPrices(bms, 'h2h', (o) => o.name === home),
      odd_x: collectPrices(bms, 'h2h', (o) => o.name === 'Draw'),
      odd_2: collectPrices(bms, 'h2h', (o) => o.name === away),
      odd_over: collectPrices(bms, 'totals', (o) => o.name === 'Over' && Number(o.point) === 2.5),
      odd_under: collectPrices(bms, 'totals', (o) => o.name === 'Under' && Number(o.point) === 2.5),
    };
    // 1X2 orani gelmeyen maci atla (ise yaramaz).
    if (!base.odd_1 || !base.odd_2) continue;

    const markets = computeMarkets(base);
    if (!markets) continue;
    await sql`
      INSERT INTO matches (id, home_team, away_team, commence_time, status, markets, last_update)
      VALUES (${ev.id}, ${home}, ${away}, ${ev.commence_time}, 'open', ${JSON.stringify(markets)}::jsonb, now())
      ON CONFLICT (id) DO UPDATE SET
        home_team=EXCLUDED.home_team, away_team=EXCLUDED.away_team,
        commence_time=EXCLUDED.commence_time, markets=EXCLUDED.markets, last_update=now()
      WHERE matches.status='open'`;
    count++;
  }

  // Gercek veri geldiyse, uygulama ici ornek maclari (sample-*) temizle.
  if (count > 0) {
    await sql`DELETE FROM coupons WHERE match_id LIKE 'sample-%'`;
    await sql`DELETE FROM matches WHERE id LIKE 'sample-%'`;
  }
  return { ok: true, count };
}

// Takim adlarini karsilastirmak icin normalize eder ("Arsenal FC" == "Arsenal").
function normName(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(a?fc)\b/g, '')
    .replace(/&|\band\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// football-data.org: bitmis maclarin mac sonu + ILK YARI skorlarini normName ile haritalar.
async function fetchFootballData() {
  const token = (process.env.FOOTBALL_DATA_TOKEN || '').trim();
  if (!token) return { map: {}, error: null, has: false };
  try {
    const res = await fetch('https://api.football-data.org/v4/competitions/PL/matches?status=FINISHED', {
      headers: { 'X-Auth-Token': token },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { map: {}, has: false, error: `football-data hatasi (${res.status}): ${body.slice(0, 140)}` };
    }
    const data = await res.json();
    const map = {};
    for (const mt of data.matches || []) {
      if (mt.status !== 'FINISHED') continue;
      const ft = mt.score && mt.score.fullTime, ht = mt.score && mt.score.halfTime;
      if (!ft || ft.home == null || ft.away == null) continue;
      const key = normName(mt.homeTeam && mt.homeTeam.name) + '|' + normName(mt.awayTeam && mt.awayTeam.name);
      map[key] = {
        ftH: ft.home, ftA: ft.away,
        htH: ht && Number.isInteger(ht.home) ? ht.home : null,
        htA: ht && Number.isInteger(ht.away) ? ht.away : null,
      };
    }
    return { map, has: true, error: null };
  } catch (e) {
    return { map: {}, has: false, error: String(e.message || e) };
  }
}

// football-data.org: Premier Lig puan durumu (lig tablosu).
// Ucretsiz plan ~10 istek/dk oldugu icin sonucu kisa sure bellekte tutariz.
let standingsCache = { at: 0, data: null };
async function fetchStandings() {
  const token = (process.env.FOOTBALL_DATA_TOKEN || '').trim();
  if (!token) return { ok: false, error: 'Puan durumu icin FOOTBALL_DATA_TOKEN gerekli.' };
  // 5 dakikalik bellek onbellegi (sicak instance icinde)
  const now = Date.now();
  if (standingsCache.data && now - standingsCache.at < 5 * 60 * 1000) {
    return { ok: true, table: standingsCache.data, cached: true };
  }
  try {
    const res = await fetch('https://api.football-data.org/v4/competitions/PL/standings', {
      headers: { 'X-Auth-Token': token },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `football-data hatasi (${res.status}): ${body.slice(0, 140)}` };
    }
    const data = await res.json();
    const total = (data.standings || []).find((s) => s.type === 'TOTAL') || (data.standings || [])[0];
    const table = (total && total.table ? total.table : []).map((r) => ({
      pos: r.position,
      team: (r.team && (r.team.shortName || r.team.name)) || '',
      full: (r.team && r.team.name) || '',
      played: r.playedGames,
      won: r.won,
      draw: r.draw,
      lost: r.lost,
      gf: r.goalsFor,
      ga: r.goalsAgainst,
      gd: r.goalDifference,
      points: r.points,
      form: r.form || null,
    }));
    standingsCache = { at: now, data: table };
    return { ok: true, table };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

// The Odds API: bitmis maclarin mac sonu skorlarini normName ile haritalar.
async function fetchOddsScores() {
  if (!hasApi()) return { map: {}, has: false, error: 'ODDS_API_KEY yok' };
  try {
    const res = await fetch(`${BASE}/sports/${SPORT}/scores/?apiKey=${apiKey()}&daysFrom=3&dateFormat=iso`);
    if (!res.ok) return { map: {}, has: false, error: `Odds API skor hatasi (${res.status})` };
    const games = await res.json();
    const map = {};
    for (const g of games) {
      if (!g.completed || !Array.isArray(g.scores)) continue;
      const h = Number(g.scores.find((s) => s.name === g.home_team)?.score);
      const a = Number(g.scores.find((s) => s.name === g.away_team)?.score);
      if (Number.isNaN(h) || Number.isNaN(a)) continue;
      map[normName(g.home_team) + '|' + normName(g.away_team)] = { ftH: h, ftA: a };
    }
    return { map, has: true, error: null };
  } catch (e) {
    return { map: {}, has: false, error: String(e.message || e) };
  }
}

// CIFT KAYNAK DOGRULAMA:
// - Mac sonu skoru iki kaynakta AYNI ise otomatik sonuclandirilir (IY skoru football-data'dan).
// - Farkli ise ya da tek kaynak varsa: sonuclandirilmaz, admin'e uyari dondurulur (elle girer).
async function refreshResults(settleFn) {
  const fd = await fetchFootballData();

  // football-data token yoksa: dogrulama kapali -> tek kaynak (Odds API), ilk yari iade.
  if (!fd.has) {
    const oa = await fetchOddsScores();
    if (!oa.has) return { ok: false, error: fd.error || oa.error || 'Skor kaynagi bulunamadi.' };
    const openM = await sql`SELECT id, home_team, away_team FROM matches WHERE status='open'`;
    let s = 0;
    for (const m of openM) {
      const o = oa.map[normName(m.home_team) + '|' + normName(m.away_team)];
      if (o) { await settleFn(m.id, o.ftH, o.ftA); s++; }
    }
    return { ok: true, settled: s, conflicts: [], fdActive: false, fdError: fd.error };
  }

  const oa = await fetchOddsScores();
  const open = await sql`SELECT id, home_team, away_team FROM matches WHERE status='open'`;

  let settled = 0;
  const conflicts = [];
  for (const m of open) {
    const key = normName(m.home_team) + '|' + normName(m.away_team);
    const f = fd.map[key];   // {ftH,ftA,htH,htA}
    const o = oa.map[key];   // {ftH,ftA}
    const teams = `${m.home_team} - ${m.away_team}`;

    if (f && o) {
      if (f.ftH === o.ftH && f.ftA === o.ftA) {
        await settleFn(m.id, f.ftH, f.ftA, f.htH, f.htA); // dogrulandi -> yaz (IY: football-data)
        settled++;
      } else {
        conflicts.push({ id: m.id, teams, fd: `${f.ftH}-${f.ftA}`, odds: `${o.ftH}-${o.ftA}`, reason: 'skorlar farkli' });
      }
    } else if (f && !o) {
      conflicts.push({ id: m.id, teams, fd: `${f.ftH}-${f.ftA}`, odds: '—', reason: 'Odds API skoru yok, doğrulanamadı' });
    } else if (!f && o) {
      conflicts.push({ id: m.id, teams, fd: '—', odds: `${o.ftH}-${o.ftA}`, reason: 'football-data skoru yok, doğrulanamadı' });
    }
    // ikisi de yoksa: mac muhtemelen bitmedi -> atla
  }
  return { ok: true, settled, conflicts, fdError: fd.error, oaError: oa.error, fdActive: fd.has };
}

module.exports = { refreshMatches, refreshResults, hasApi, normName, fetchStandings };
