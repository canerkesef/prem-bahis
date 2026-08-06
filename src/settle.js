'use strict';

const { sql } = require('./db');
const { CS_SCORES } = require('./odds-derive');

// Bir kuponun (market + selection) verilen skora gore kazanip kazanmadigi.
function isWinner(market, sel, h, a) {
  const total = h + a;
  const res = h > a ? '1' : h === a ? 'X' : '2';
  const btts = h > 0 && a > 0 ? 'var' : 'yok';
  const ou25 = total > 2 ? 'ust' : 'alt';
  const ouOver = (line) => (sel === 'over' ? total > line : total < line);

  switch (market) {
    case '1x2':
      return sel === res;
    case 'dc':
      return (
        (sel === '1x' && res !== '2') ||
        (sel === '12' && res !== 'X') ||
        (sel === 'x2' && res !== '1')
      );
    case 'hcap': { const r = h - 1 > a ? '1' : h - 1 === a ? 'X' : '2'; return sel === r; }
    case 'hcap_a': { const r = h > a - 1 ? '1' : h === a - 1 ? 'X' : '2'; return sel === r; }
    case 'ou05': return ouOver(0.5);
    case 'ou15': return ouOver(1.5);
    case 'ou25': return ouOver(2.5);
    case 'ou35': return ouOver(3.5);
    case 'ou45': return ouOver(4.5);
    case 'oe': return sel === 'even' ? total % 2 === 0 : total % 2 === 1;
    case 'btts': return sel === btts;
    case 'goals_band':
      if (sel === '0-1') return total <= 1;
      if (sel === '2-3') return total >= 2 && total <= 3;
      if (sel === '4-5') return total >= 4 && total <= 5;
      if (sel === '6+') return total >= 6;
      return false;
    case 'h_ou05': return sel === 'over' ? h > 0.5 : h < 0.5;
    case 'h_ou15': return sel === 'over' ? h > 1.5 : h < 1.5;
    case 'h_ou25': return sel === 'over' ? h > 2.5 : h < 2.5;
    case 'a_ou05': return sel === 'over' ? a > 0.5 : a < 0.5;
    case 'a_ou15': return sel === 'over' ? a > 1.5 : a < 1.5;
    case 'a_ou25': return sel === 'over' ? a > 2.5 : a < 2.5;
    case 'ms_ou25': { const [r, ou] = sel.split('-'); return r === res && ou === ou25; }
    case 'ms_btts': { const [r, bt] = sel.split('-'); return r === res && bt === btts; }
    case 'btts_ou25': { const [bt, ou] = sel.split('-'); return bt === btts && ou === ou25; }
    case 'cs':
      if (sel === 'diger') return !CS_SCORES.includes(`${h}-${a}`);
      return sel === `${h}-${a}`;
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
