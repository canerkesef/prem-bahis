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

// Tamamlanan maclarin skorlarini ceker ve kuponlari hesaplar.
async function refreshResults(settleFn) {
  if (!hasApi()) {
    return { ok: false, error: 'ODDS_API_KEY tanimli degil.' };
  }
  const url = `${BASE}/sports/${SPORT}/scores/?apiKey=${apiKey()}&daysFrom=3&dateFormat=iso`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `The Odds API skor hatasi (${res.status}): ${body.slice(0, 200)}` };
  }
  const games = await res.json();
  let settled = 0;
  for (const g of games) {
    if (!g.completed || !Array.isArray(g.scores)) continue;
    const existing = await sql`SELECT id, status FROM matches WHERE id = ${g.id}`;
    if (existing.length === 0 || existing[0].status === 'settled') continue;
    const homeScore = Number(g.scores.find((s) => s.name === g.home_team)?.score);
    const awayScore = Number(g.scores.find((s) => s.name === g.away_team)?.score);
    if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) continue;
    await settleFn(g.id, homeScore, awayScore);
    settled++;
  }
  return { ok: true, settled };
}

module.exports = { refreshMatches, refreshResults, hasApi };
