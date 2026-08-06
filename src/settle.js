'use strict';

const { sql } = require('./db');

// Bir kuponun (market + selection) verilen skora gore kazanip kazanmadigi.
function isWinner(market, sel, h, a) {
  const total = h + a;
  const res = h > a ? '1' : h === a ? 'X' : '2';
  switch (market) {
    case '1x2':
      return sel === res;
    case 'dc': // cifte sans
      return (
        (sel === '1x' && (res === '1' || res === 'X')) ||
        (sel === '12' && (res === '1' || res === '2')) ||
        (sel === 'x2' && (res === 'X' || res === '2'))
      );
    case 'ou15':
      return sel === 'over' ? total > 1 : total <= 1;
    case 'ou25':
      return sel === 'over' ? total > 2 : total <= 2;
    case 'ou35':
      return sel === 'over' ? total > 3 : total <= 3;
    case 'oe': // tek/cift
      return sel === 'even' ? total % 2 === 0 : total % 2 === 1;
    case 'btts':
      return sel === 'yes' ? h > 0 && a > 0 : !(h > 0 && a > 0);
    case 'hcap': { // handikap: ev sahibi -1
      const ah = h - 1;
      const r = ah > a ? '1' : ah === a ? 'X' : '2';
      return sel === r;
    }
    default:
      return false;
  }
}

// Bir maci verilen skorla sonuclandirir, bekleyen kuponlari hesaplar,
// kazanan kuponlarin sahiplerine kazanci bakiyeye ekler.
async function settleMatch(matchId, homeScore, awayScore) {
  const found = await sql`SELECT id, status FROM matches WHERE id = ${matchId}`;
  if (found.length === 0) throw new Error('Mac bulunamadi');
  if (found[0].status === 'settled') return { alreadySettled: true };

  await sql.begin(async (tx) => {
    await tx`
      UPDATE matches SET status='settled', home_score=${homeScore}, away_score=${awayScore}
      WHERE id=${matchId}`;

    const coupons = await tx`
      SELECT id, user_id, market, selection, potential_win
      FROM coupons WHERE match_id=${matchId} AND status='pending'`;

    for (const c of coupons) {
      const won = isWinner(c.market, c.selection, homeScore, awayScore);
      if (won) {
        await tx`UPDATE coupons SET status='won', settled_at=now() WHERE id=${c.id}`;
        await tx`UPDATE users SET balance = balance + ${c.potential_win} WHERE id=${c.user_id}`;
      } else {
        await tx`UPDATE coupons SET status='lost', settled_at=now() WHERE id=${c.id}`;
      }
    }
  });

  return { ok: true };
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
