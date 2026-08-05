'use strict';

// API anahtari yoksa uygulamanin hemen denenebilmesi icin
// ornek Premier Lig maclari olusturur.
const { sql } = require('./db');

function daysFromNow(d, hour = 17) {
  const dt = new Date(Date.now() + d * 24 * 60 * 60 * 1000);
  dt.setUTCHours(hour, 0, 0, 0);
  return dt.toISOString();
}

const SAMPLE = [
  ['Arsenal', 'Chelsea', 2.10, 3.40, 3.30, 1.80, 2.00, 1.70, 2.10],
  ['Manchester City', 'Liverpool', 1.95, 3.60, 3.70, 1.65, 2.25, 1.60, 2.30],
  ['Manchester United', 'Tottenham Hotspur', 2.45, 3.50, 2.75, 1.75, 2.05, 1.75, 2.05],
  ['Newcastle United', 'Aston Villa', 2.20, 3.30, 3.20, 1.85, 1.95, 1.80, 2.00],
  ['Brighton', 'West Ham United', 1.90, 3.70, 4.00, 1.90, 1.90, 1.85, 1.95],
  ['Everton', 'Nottingham Forest', 2.60, 3.10, 2.80, 2.10, 1.72, 2.00, 1.80],
];

let seedRan = null;
function seedSampleMatches() {
  if (seedRan) return seedRan;
  seedRan = (async () => {
    const rows = await sql`SELECT count(*)::int AS c FROM matches WHERE status='open'`;
    if (rows[0].c > 0) return 0;
    let i = 0;
    for (const s of SAMPLE) {
      i++;
      await sql`
        INSERT INTO matches (id, home_team, away_team, commence_time, status,
          odd_1, odd_x, odd_2, odd_over, odd_under, odd_btts_yes, odd_btts_no)
        VALUES (${'sample-' + i}, ${s[0]}, ${s[1]}, ${daysFromNow(i)}, 'open',
          ${s[2]}, ${s[3]}, ${s[4]}, ${s[5]}, ${s[6]}, ${s[7]}, ${s[8]})
        ON CONFLICT (id) DO NOTHING`;
    }
    console.log(`[seed] ${i} ornek mac eklendi (API anahtari yok).`);
    return i;
  })().catch((e) => {
    seedRan = null;
    throw e;
  });
  return seedRan;
}

module.exports = { seedSampleMatches };
