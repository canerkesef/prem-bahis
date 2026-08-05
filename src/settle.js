'use strict';

const { sql } = require('./db');

// Bir maci verilen skorla sonuclandirir, bekleyen kuponlari hesaplar,
// kazanan kuponlarin sahiplerine kazanci bakiyeye ekler.
async function settleMatch(matchId, homeScore, awayScore) {
  const found = await sql`SELECT id, status FROM matches WHERE id = ${matchId}`;
  if (found.length === 0) throw new Error('Mac bulunamadi');
  if (found[0].status === 'settled') return { alreadySettled: true };

  const total = homeScore + awayScore;
  const results = {
    '1x2': homeScore > awayScore ? '1' : homeScore === awayScore ? 'X' : '2',
    ou25: total > 2 ? 'over' : 'under',
    btts: homeScore > 0 && awayScore > 0 ? 'yes' : 'no',
  };

  await sql.begin(async (tx) => {
    await tx`
      UPDATE matches SET status='settled', home_score=${homeScore}, away_score=${awayScore}
      WHERE id=${matchId}`;

    const coupons = await tx`
      SELECT id, user_id, market, selection, potential_win
      FROM coupons WHERE match_id=${matchId} AND status='pending'`;

    for (const c of coupons) {
      const won = results[c.market] === c.selection;
      if (won) {
        await tx`UPDATE coupons SET status='won', settled_at=now() WHERE id=${c.id}`;
        await tx`UPDATE users SET balance = balance + ${c.potential_win} WHERE id=${c.user_id}`;
      } else {
        await tx`UPDATE coupons SET status='lost', settled_at=now() WHERE id=${c.id}`;
      }
    }
  });

  return { ok: true, results };
}

// Maci iptal eder (void) ve tum bekleyen kuponlarin bahsini iade eder.
async function voidMatch(matchId) {
  const found = await sql`SELECT id FROM matches WHERE id = ${matchId}`;
  if (found.length === 0) throw new Error('Mac bulunamadi');

  await sql.begin(async (tx) => {
    await tx`UPDATE matches SET status='void' WHERE id=${matchId}`;
    const coupons = await tx`
      SELECT id, user_id, stake FROM coupons WHERE match_id=${matchId} AND status='pending'`;
    for (const c of coupons) {
      await tx`UPDATE coupons SET status='void', settled_at=now() WHERE id=${c.id}`;
      await tx`UPDATE users SET balance = balance + ${c.stake} WHERE id=${c.user_id}`;
    }
  });

  return { ok: true };
}

module.exports = { settleMatch, voidMatch };
