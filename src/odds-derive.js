'use strict';

// Yeni bahis turlerinin oranlarini, mevcut temel oranlardan (1X2 ve 2.5 Alt/Ust)
// tureten yardimci. Boylece ek API istegi gerekmeden, hem canli hem ornek modda calisir.

function price(prob, margin = 0.06) {
  if (!prob || prob <= 0) return null;
  let o = 1 / (prob * (1 + margin));
  o = Math.min(20, Math.max(1.05, o));
  return Math.round(o * 100) / 100;
}

// base: { odd_1, odd_x, odd_2, odd_over, odd_under }
function computeExtraOdds(base) {
  const out = {
    odd_dc_1x: null, odd_dc_12: null, odd_dc_x2: null,
    odd_over15: null, odd_under15: null, odd_over35: null, odd_under35: null,
    odd_odd: null, odd_even: null,
    odd_h1: null, odd_hx: null, odd_h2: null,
  };
  const o1 = base.odd_1, ox = base.odd_x, o2 = base.odd_2;
  if (o1 && ox && o2) {
    const r1 = 1 / o1, rx = 1 / ox, r2 = 1 / o2, s = r1 + rx + r2;
    const P1 = r1 / s, PX = rx / s, P2 = r2 / s;
    // Cifte Sans
    out.odd_dc_1x = price(P1 + PX);
    out.odd_dc_12 = price(P1 + P2);
    out.odd_dc_x2 = price(PX + P2);
    // Handikap (Ev -1): ev sahibi galibiyetlerinin ~%45'i tek farkla varsayimi
    const a = 0.55 * P1;       // ev 2+ farkla kazanir  -> "1"
    const b = 0.45 * P1;       // ev tam 1 farkla kazanir -> "X"
    const c = PX + P2;         // beraberlik veya deplasman -> "2"
    out.odd_h1 = price(a);
    out.odd_hx = price(b);
    out.odd_h2 = price(c);
  }
  // Toplam gol tek/cift (~50/50, cift hafif onde)
  out.odd_even = price(0.505);
  out.odd_odd = price(0.495);
  // Alt/Ust 1.5 ve 3.5, 2.5 cizgisinden tahmini
  const oo = base.odd_over, ou = base.odd_under;
  let Pover25 = null;
  if (oo && ou) {
    const rO = 1 / oo, rU = 1 / ou;
    Pover25 = rO / (rO + rU);
    const Pover15 = Math.min(0.97, Math.max(0.5, Pover25 + 0.24));
    const Pover35 = Math.max(0.05, Math.min(0.5, Pover25 - 0.24));
    out.odd_over15 = price(Pover15);
    out.odd_under15 = price(1 - Pover15);
    out.odd_over35 = price(Pover35);
    out.odd_under35 = price(1 - Pover35);
  }
  // Karsilikli Gol (KG Var/Yok): 2.5 ust olasiligindan tahmin.
  // API'den gelmezse bu deger yedek olarak kullanilir.
  const Pbtts = Pover25 != null ? Math.min(0.75, Math.max(0.3, 0.3 + 0.55 * Pover25)) : 0.52;
  out.odd_btts_yes = price(Pbtts);
  out.odd_btts_no = price(1 - Pbtts);
  return out;
}

module.exports = { computeExtraOdds };
