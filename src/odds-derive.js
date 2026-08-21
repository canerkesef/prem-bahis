'use strict';

// Mevcut temel oranlardan (1X2 + Alt/Ust 2.5) bir gol-olasilik tablosu (Poisson)
// cikarir ve skordan sonuclanan TUM pazarlarin oranlarini bu tablodan uretir.
// Boylece kombinasyonlar dahil hepsi tutarli ve ek API gerektirmeden calisir.

const MAX = 8; // en fazla 8 gol modellenir

// Kesin skor icin listelenen skorlar (digerleri "Diger")
const CS_SCORES = [
  '1-0', '2-0', '2-1', '3-0', '3-1', '3-2',
  '0-0', '1-1', '2-2', '3-3',
  '0-1', '0-2', '1-2', '0-3', '1-3', '2-3',
];

function factorial(n) {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}
function pois(k, l) {
  return (Math.exp(-l) * Math.pow(l, k)) / factorial(k);
}
function price(prob, margin = 0.07) {
  if (!prob || prob <= 0) return null;
  let o = 1 / (prob * (1 + margin));
  o = Math.min(60, Math.max(1.05, o));
  return Math.round(o * 100) / 100;
}

// Poisson toplam golde P(toplam >= 3)
function pTotalGE3(mu) {
  return 1 - Math.exp(-mu) * (1 + mu + (mu * mu) / 2);
}
function solveMu(target) {
  let lo = 0.3, hi = 6;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (pTotalGE3(mid) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
function homeWinProb(lh, la) {
  let p = 0;
  for (let i = 0; i <= MAX; i++) for (let j = 0; j < i; j++) p += pois(i, lh) * pois(j, la);
  return p;
}
function solveS(mu, targetP1) {
  let lo = -3.5, hi = 3.5;
  for (let k = 0; k < 40; k++) {
    const s = (lo + hi) / 2;
    const lh = Math.max(0.05, (mu + s) / 2), la = Math.max(0.05, (mu - s) / 2);
    if (homeWinProb(lh, la) < targetP1) lo = s; else hi = s;
  }
  return (lo + hi) / 2;
}

// base: { odd_1, odd_x, odd_2, odd_over, odd_under }  -> tum pazarlarin oran objesi
function computeMarkets(base) {
  const o1 = base.odd_1, ox = base.odd_x, o2 = base.odd_2;
  if (!o1 || !ox || !o2) return null;

  // 1X2 marj arindirilmis olasiliklar
  const r1 = 1 / o1, rx = 1 / ox, r2 = 1 / o2, s3 = r1 + rx + r2;
  const P1 = r1 / s3;

  // toplam gol beklentisi (over/under 2.5'ten; yoksa varsayilan)
  let mu = 2.6;
  if (base.odd_over && base.odd_under) {
    const rO = 1 / base.odd_over, rU = 1 / base.odd_under;
    mu = solveMu(rO / (rO + rU));
  }
  const sSup = solveS(mu, P1);
  const lh = Math.max(0.05, (mu + sSup) / 2);
  const la = Math.max(0.05, (mu - sSup) / 2);

  // Verilen gol beklentileriyle normalize skor matrisi kurar, kosul toplayici P dondurur.
  const makeP = (LH, LA) => {
    const M = [];
    let tot = 0;
    for (let i = 0; i <= MAX; i++) {
      M[i] = [];
      for (let j = 0; j <= MAX; j++) { const p = pois(i, LH) * pois(j, LA); M[i][j] = p; tot += p; }
    }
    for (let i = 0; i <= MAX; i++) for (let j = 0; j <= MAX; j++) M[i][j] /= tot;
    const Pf = (pred) => {
      let s = 0;
      for (let i = 0; i <= MAX; i++) for (let j = 0; j <= MAX; j++) if (pred(i, j)) s += M[i][j];
      return s;
    };
    Pf.M = M;
    return Pf;
  };
  const P = makeP(lh, la);
  const two = (obj) => obj; // okunabilirlik

  const mk = {};
  // --- Mac Sonucu grubu ---
  mk['1x2'] = { '1': price(P((i, j) => i > j)), X: price(P((i, j) => i === j)), '2': price(P((i, j) => i < j)) };
  mk.dc = {
    '1x': price(P((i, j) => i >= j)),
    '12': price(P((i, j) => i !== j)),
    x2: price(P((i, j) => i <= j)),
  };
  mk.hcap = { // Ev -1
    '1': price(P((i, j) => i - 1 > j)), X: price(P((i, j) => i - 1 === j)), '2': price(P((i, j) => i - 1 < j)),
  };
  mk.hcap_a = { // Deplasman -1
    '1': price(P((i, j) => i > j - 1)), X: price(P((i, j) => i === j - 1)), '2': price(P((i, j) => i < j - 1)),
  };

  // --- Gol Bahisleri ---
  const ouLine = (line) => ({ over: price(P((i, j) => i + j > line)), under: price(P((i, j) => i + j < line)) });
  mk.ou05 = ouLine(0.5);
  mk.ou15 = ouLine(1.5);
  mk.ou25 = ouLine(2.5);
  mk.ou35 = ouLine(3.5);
  mk.ou45 = ouLine(4.5);
  mk.oe = { odd: price(P((i, j) => (i + j) % 2 === 1)), even: price(P((i, j) => (i + j) % 2 === 0)) };
  mk.btts = { yes: price(P((i, j) => i > 0 && j > 0)), no: price(P((i, j) => !(i > 0 && j > 0))) };
  mk.goals_band = {
    '0-1': price(P((i, j) => i + j <= 1)),
    '2-3': price(P((i, j) => i + j >= 2 && i + j <= 3)),
    '4-5': price(P((i, j) => i + j >= 4 && i + j <= 5)),
    '6+': price(P((i, j) => i + j >= 6)),
  };

  // --- Takim Golleri ---
  mk.h_ou05 = { over: price(P((i) => i > 0.5)), under: price(P((i) => i < 0.5)) };
  mk.h_ou15 = { over: price(P((i) => i > 1.5)), under: price(P((i) => i < 1.5)) };
  mk.h_ou25 = { over: price(P((i) => i > 2.5)), under: price(P((i) => i < 2.5)) };
  mk.a_ou05 = { over: price(P((i, j) => j > 0.5)), under: price(P((i, j) => j < 0.5)) };
  mk.a_ou15 = { over: price(P((i, j) => j > 1.5)), under: price(P((i, j) => j < 1.5)) };
  mk.a_ou25 = { over: price(P((i, j) => j > 2.5)), under: price(P((i, j) => j < 2.5)) };

  // --- Kombinasyonlar ---
  const resOf = (i, j) => (i > j ? '1' : i === j ? 'X' : '2');
  mk.ms_ou25 = {
    '1-ust': price(P((i, j) => resOf(i, j) === '1' && i + j > 2)),
    '1-alt': price(P((i, j) => resOf(i, j) === '1' && i + j < 3)),
    'X-ust': price(P((i, j) => resOf(i, j) === 'X' && i + j > 2)),
    'X-alt': price(P((i, j) => resOf(i, j) === 'X' && i + j < 3)),
    '2-ust': price(P((i, j) => resOf(i, j) === '2' && i + j > 2)),
    '2-alt': price(P((i, j) => resOf(i, j) === '2' && i + j < 3)),
  };
  mk.ms_btts = {
    '1-var': price(P((i, j) => resOf(i, j) === '1' && i > 0 && j > 0)),
    '1-yok': price(P((i, j) => resOf(i, j) === '1' && !(i > 0 && j > 0))),
    'X-var': price(P((i, j) => resOf(i, j) === 'X' && i > 0 && j > 0)),
    'X-yok': price(P((i, j) => resOf(i, j) === 'X' && !(i > 0 && j > 0))),
    '2-var': price(P((i, j) => resOf(i, j) === '2' && i > 0 && j > 0)),
    '2-yok': price(P((i, j) => resOf(i, j) === '2' && !(i > 0 && j > 0))),
  };
  mk.btts_ou25 = {
    'var-ust': price(P((i, j) => i > 0 && j > 0 && i + j > 2)),
    'var-alt': price(P((i, j) => i > 0 && j > 0 && i + j < 3)),
    'yok-ust': price(P((i, j) => !(i > 0 && j > 0) && i + j > 2)),
    'yok-alt': price(P((i, j) => !(i > 0 && j > 0) && i + j < 3)),
  };

  // --- Kesin Skor ---
  const cs = {};
  let listed = 0;
  for (const sc of CS_SCORES) {
    const [hi, aj] = sc.split('-').map(Number);
    const p = P.M[hi][aj];
    listed += p;
    cs[sc] = price(p);
  }
  cs['diger'] = price(Math.max(0, 1 - listed));
  mk.cs = cs;

  // --- Ilk Yari (devre) --- gol beklentisi ~%47; ayri matris.
  // Ilk yari pazarlarinda marj biraz daha yuksek (gercek sitelerdeki gibi) -> oranlar daha makul.
  const HT = makeP(lh * 0.45, la * 0.45);
  const iyPrice = (p) => price(p, 0.16);
  mk.iy_1x2 = {
    '1': iyPrice(HT((i, j) => i > j)), X: iyPrice(HT((i, j) => i === j)), '2': iyPrice(HT((i, j) => i < j)),
  };
  mk.iy_ou05 = { over: iyPrice(HT((i, j) => i + j > 0.5)), under: iyPrice(HT((i, j) => i + j < 0.5)) };
  mk.iy_ou15 = { over: iyPrice(HT((i, j) => i + j > 1.5)), under: iyPrice(HT((i, j) => i + j < 1.5)) };
  mk.iy_btts = { yes: iyPrice(HT((i, j) => i > 0 && j > 0)), no: iyPrice(HT((i, j) => !(i > 0 && j > 0))) };

  return two(mk);
}

module.exports = { computeMarkets, CS_SCORES };
