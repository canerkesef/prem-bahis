'use strict';

const { sql } = require('./db');
const { CS_SCORES } = require('./odds-derive');

// KURAL 1'deki minimum tutar (KURAL 13 elenme kontrolu icin de kullanilir).
const MIN_STAKE = Number(process.env.MIN_STAKE || 50);

// KURAL 13: Bakiyesi minimum kupon tutarindan az olan ve bekleyen kuponu
// olmayan onayli oyuncular "Kaybetti" (eliminated) olarak isaretlenir.
// Bakiye tekrar yeterli olursa (duzeltme/iade/bakiye edit) isaret kaldirilir.
async function recomputeEliminations(tx) {
  // Admin de oyuncu sayilir; onaylanmis herkes icin hesaplanir.
  await tx`
    UPDATE users u SET eliminated =
      (u.balance < ${MIN_STAKE} AND NOT EXISTS (
        SELECT 1 FROM coupons c WHERE c.user_id = u.id AND c.status = 'pending'))
    WHERE u.status = 'approved'`;
}

// Bir kuponun (market + selection) verilen skora gore kazanip kazanmadigi.
// Ilk yari (iy_) pazarlari icin cagiran taraf DEVRE skorunu verir; mantik aynidir.
function isWinner(market, sel, h, a) {
  if (market.startsWith('iy_')) market = market.slice(3);
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
    case 'btts': return sel === 'yes' ? h > 0 && a > 0 : !(h > 0 && a > 0);
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
// htHome/htAway: devre arasi (ilk yari) skoru. null ise ilk yari kuponlari iade edilir.
async function settleMatch(matchId, homeScore, awayScore, htHome = null, htAway = null, opts = {}) {
  const correct = opts.correct === true; // KURAL 8: yonetici duzeltmesi (yeniden sonuclandirma)
  const found = await sql`SELECT id, status FROM matches WHERE id = ${matchId}`;
  if (found.length === 0) throw new Error('Mac bulunamadi');
  const wasSettled = found[0].status === 'settled';
  if (wasSettled && !correct) return { alreadySettled: true };
  const haveHT = Number.isInteger(htHome) && Number.isInteger(htAway);

  await sql.begin(async (tx) => {
    // KURAL 8: Zaten sonuclanmis maci duzeltiyorsak once eski kupon etkilerini geri al.
    // (Katilim cezasi skordan bagimsizdir; kimin kupon yapmadigi degismez, dokunulmaz.)
    if (wasSettled && correct) {
      const prev = await tx`
        SELECT user_id, status, stake, potential_win
        FROM coupons WHERE match_id=${matchId} AND status IN ('won','void')`;
      for (const c of prev) {
        const amt = c.status === 'won' ? c.potential_win : c.stake; // won: kazanc geri; void: iade geri
        // KURAL 4: eksi bakiyeye dusme (geri alma bakiyeyi 0'in altina cekmez).
        await tx`UPDATE users SET balance = GREATEST(balance - ${amt}, 0) WHERE id=${c.user_id}`;
      }
      await tx`UPDATE coupons SET status='pending', settled_at=NULL WHERE match_id=${matchId}`;
    }

    await tx`
      UPDATE matches SET status='settled', home_score=${homeScore}, away_score=${awayScore},
        ht_home=${haveHT ? htHome : null}, ht_away=${haveHT ? htAway : null}
      WHERE id=${matchId}`;

    const coupons = await tx`
      SELECT id, user_id, market, selection, stake, potential_win
      FROM coupons WHERE match_id=${matchId} AND status='pending'`;

    for (const c of coupons) {
      const isIY = c.market.startsWith('iy_');
      if (isIY && !haveHT) {
        // Devre skoru bilinmiyor -> ilk yari kuponu iade (bahis geri)
        await tx`UPDATE coupons SET status='void', settled_at=now() WHERE id=${c.id}`;
        await tx`UPDATE users SET balance = balance + ${c.stake} WHERE id=${c.user_id}`;
        continue;
      }
      const won = isIY
        ? isWinner(c.market, c.selection, htHome, htAway)
        : isWinner(c.market, c.selection, homeScore, awayScore);
      if (won) {
        await tx`UPDATE coupons SET status='won', settled_at=now() WHERE id=${c.id}`;
        await tx`UPDATE users SET balance = balance + ${c.potential_win} WHERE id=${c.user_id}`;
      } else {
        await tx`UPDATE coupons SET status='lost', settled_at=now() WHERE id=${c.id}`;
      }
    }

    // KURAL 3: Bu maca hic kupon yapmamis onayli oyunculardan katilim cezasi dus.
    // Admin de oyuncu sayilir. Yalnizca ILK sonuclandirmada uygulanir; duzeltmede tekrar uygulanmaz.
    const penalty = Number(process.env.NO_BET_PENALTY || 100);
    if (penalty > 0 && !(wasSettled && correct)) {
      await tx`
        UPDATE users SET balance = GREATEST(balance - ${penalty}, 0)
        WHERE status='approved'
          AND id NOT IN (SELECT user_id FROM coupons WHERE match_id=${matchId})`;
    }

    // KURAL 13: Bakiyeleri degisti -> elenme durumlarini yeniden hesapla.
    await recomputeEliminations(tx);
  });

  return { ok: true, corrected: wasSettled && correct };
}

// Zaten sonuclanmis ama ILK YARI skoru islenmemis (ht_home NULL) bir maca,
// sonradan (ornegin football-data'dan) gelen devre skorunu uygular:
// iade edilmis (void) ilk yari kuponlarini yeni devre skoruna gore hesaplar.
// Mac sonu kuponlarina dokunmaz. Skor stored FT ile ayni kalir.
async function applyHalfTime(matchId, htHome, htAway) {
  if (!Number.isInteger(htHome) || !Number.isInteger(htAway)) return { ok: false, error: 'Devre skoru gecersiz' };
  const rows = await sql`SELECT status, ht_home FROM matches WHERE id=${matchId}`;
  if (!rows.length) return { ok: false, error: 'Mac bulunamadi' };
  if (rows[0].status !== 'settled') return { ok: false, error: 'Mac sonuclanmamis' };
  if (rows[0].ht_home != null) return { ok: false, error: 'Ilk yari zaten islenmis' };

  let iyCount = 0;
  await sql.begin(async (tx) => {
    const iy = await tx`
      SELECT id, user_id, market, selection, stake, potential_win
      FROM coupons WHERE match_id=${matchId} AND market LIKE 'iy_%' AND status='void'`;
    for (const c of iy) {
      // Onceki iadeyi geri al, sonra devre skoruna gore hesapla.
      await tx`UPDATE users SET balance = GREATEST(balance - ${c.stake}, 0) WHERE id=${c.user_id}`;
      if (isWinner(c.market, c.selection, htHome, htAway)) {
        await tx`UPDATE coupons SET status='won', settled_at=now() WHERE id=${c.id}`;
        await tx`UPDATE users SET balance = balance + ${c.potential_win} WHERE id=${c.user_id}`;
      } else {
        await tx`UPDATE coupons SET status='lost', settled_at=now() WHERE id=${c.id}`;
      }
      iyCount++;
    }
    await tx`UPDATE matches SET ht_home=${htHome}, ht_away=${htAway} WHERE id=${matchId}`;
    await recomputeEliminations(tx);
  });
  return { ok: true, iyCount };
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
    // KURAL 13: Iade sonrasi elenme durumlarini yeniden hesapla.
    await recomputeEliminations(tx);
  });

  return { ok: true };
}

module.exports = { settleMatch, voidMatch, applyHalfTime };
