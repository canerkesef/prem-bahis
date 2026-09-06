'use strict';

// ---------- Yardimcilar ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// Boş metal su kovası ikonu (sonunculuk rozeti) — kulbu yana sarkık, küçük satır içi SVG.
const BUCKET_SVG = '<svg class="bkt" viewBox="0 0 24 26" width="12" height="13" aria-hidden="true">'
  + '<ellipse cx="12" cy="10" rx="7" ry="2" fill="#e6ebef" stroke="#9aa3ad" stroke-width=".8"/>'
  + '<path d="M5.3 10 L18.7 10 L16.7 22.4 Q16.5 23.7 15.2 23.7 L8.8 23.7 Q7.5 23.7 7.3 22.4 Z" fill="#c9d0d7" stroke="#8f98a2" stroke-width=".8"/>'
  + '<path d="M8 10.3 L7.4 22.5 Q7.35 22.9 7.8 23.1 L8.9 23.3 L9.2 10.3 Z" fill="#eef2f5" opacity=".6"/>'
  + '<circle cx="6" cy="10.2" r="1" fill="#b7bfc7" stroke="#8f98a2" stroke-width=".5"/>'
  + '<circle cx="18" cy="10.2" r="1" fill="#b7bfc7" stroke="#8f98a2" stroke-width=".5"/>'
  + '<path d="M6.2 10.4 Q13 16 18 10.4" fill="none" stroke="#7b838d" stroke-width="1.3"/>'
  + '</svg>';

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Bir hata olustu'); e.data = data; e.status = res.status; throw e; }
  return data;
}

// Para birimi: ASCU (arkadaslarin bas harflerinden turetilmis SANAL puan; gercek para degildir)
function fmtTL(n) {
  return Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' ASCU';
}
const TZ = 'Europe/Istanbul';
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ });
}
// Kuponun oynanma anini SANIYESINE kadar gosterir (cift kupon kontrolu icin).
function fmtStamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: TZ });
}
function fmtKick(iso) {
  const d = new Date(iso);
  return {
    day: d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', timeZone: TZ }),
    time: d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: TZ }),
  };
}

// Takim renkleri (arma rozeti icin). Bulunamazsa isimden uretilir.
const TEAM_COLORS = {
  'arsenal': ['#EF0107', 'ARS'], 'aston villa': ['#95BFE5', 'AVL'], 'bournemouth': ['#DA291C', 'BOU'],
  'brentford': ['#E30613', 'BRE'], 'brighton': ['#0057B8', 'BHA'], 'burnley': ['#6C1D45', 'BUR'],
  'chelsea': ['#034694', 'CHE'], 'crystal palace': ['#1B458F', 'CRY'], 'everton': ['#003399', 'EVE'],
  'fulham': ['#111111', 'FUL'], 'ipswich': ['#3A64A3', 'IPS'], 'leeds': ['#1D428A', 'LEE'],
  'leicester': ['#003090', 'LEI'], 'liverpool': ['#C8102E', 'LIV'], 'luton': ['#F78F1E', 'LUT'],
  'manchester city': ['#6CABDD', 'MCI'], 'manchester united': ['#DA291C', 'MUN'], 'newcastle': ['#241F20', 'NEW'],
  'nottingham forest': ['#DD0000', 'NFO'], 'sheffield': ['#EE2737', 'SHU'], 'southampton': ['#D71920', 'SOU'],
  'tottenham': ['#132257', 'TOT'], 'west ham': ['#7A263A', 'WHU'], 'wolverhampton': ['#FDB913', 'WOL'],
  'wolves': ['#FDB913', 'WOL'], 'sunderland': ['#EB172B', 'SUN'], 'hull': ['#F5A12D', 'HUL'],
  'coventry': ['#78D0F1', 'COV'],
};
function hashColor(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 55%, 42%)`;
}
function pickFg(bg) {
  if (bg.startsWith('#')) {
    const r = parseInt(bg.slice(1, 3), 16), g = parseInt(bg.slice(3, 5), 16), b = parseInt(bg.slice(5, 7), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.62 ? '#1c1930' : '#ffffff';
  }
  return '#ffffff';
}
function teamCrest(name) {
  const lower = (name || '').toLowerCase();
  for (const key of Object.keys(TEAM_COLORS)) {
    if (lower.includes(key)) {
      const [bg, code] = TEAM_COLORS[key];
      return { bg, fg: pickFg(bg), code };
    }
  }
  const words = lower.split(/\s+/).filter(Boolean);
  const code = (words.length >= 2 ? words[0][0] + words[1][0] + (words[0][1] || '') : (name || '').slice(0, 3)).toUpperCase();
  const bg = hashColor(lower);
  return { bg, fg: '#ffffff', code };
}
function crestEl(name) {
  const c = teamCrest(name);
  return `<span class="crest" style="background:${c.bg};color:${c.fg}">${c.code}</span>`;
}
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  setTimeout(() => t.classList.add('hidden'), 2600);
}

// Kesin skor seçenekleri (odds-derive ile ayni sirada) + Diger
const CS_LIST = [
  ['1-0', '1-0'], ['2-0', '2-0'], ['2-1', '2-1'], ['3-0', '3-0'], ['3-1', '3-1'], ['3-2', '3-2'],
  ['0-0', '0-0'], ['1-1', '1-1'], ['2-2', '2-2'], ['3-3', '3-3'],
  ['0-1', '0-1'], ['0-2', '0-2'], ['1-2', '1-2'], ['0-3', '0-3'], ['1-3', '1-3'], ['2-3', '2-3'],
  ['diger', 'Diğer'],
];

// Tum pazarlar, gruplu. Tek kaynak: hem arayuz hem etiketler buradan uretilir.
const MARKET_GROUPS = [
  { title: 'Maç Sonucu', open: true, markets: [
    { key: '1x2', label: 'Maç Sonucu', cols: 3, sels: [['1', 'Ev (1)'], ['X', 'Berabere (X)'], ['2', 'Dep (2)']] },
    { key: 'dc', label: 'Çifte Şans', cols: 3, sels: [['1x', '1-X'], ['12', '1-2'], ['x2', 'X-2']] },
    { key: 'hcap', label: 'Handikap (Ev -1)', cols: 3, sels: [['1', 'Ev -1'], ['X', 'Ber. (-1)'], ['2', 'Dep +1']] },
    { key: 'hcap_a', label: 'Handikap (Dep -1)', cols: 3, sels: [['1', 'Ev +1'], ['X', 'Ber. (-1)'], ['2', 'Dep -1']] },
  ] },
  { title: 'Gol Bahisleri', open: true, markets: [
    { key: 'ou05', label: 'Alt / Üst 0.5', cols: 2, sels: [['over', '0.5 Üst'], ['under', '0.5 Alt']] },
    { key: 'ou15', label: 'Alt / Üst 1.5', cols: 2, sels: [['over', '1.5 Üst'], ['under', '1.5 Alt']] },
    { key: 'ou25', label: 'Alt / Üst 2.5', cols: 2, sels: [['over', '2.5 Üst'], ['under', '2.5 Alt']] },
    { key: 'ou35', label: 'Alt / Üst 3.5', cols: 2, sels: [['over', '3.5 Üst'], ['under', '3.5 Alt']] },
    { key: 'ou45', label: 'Alt / Üst 4.5', cols: 2, sels: [['over', '4.5 Üst'], ['under', '4.5 Alt']] },
    { key: 'btts', label: 'Karşılıklı Gol', cols: 2, sels: [['yes', 'KG Var'], ['no', 'KG Yok']] },
    { key: 'oe', label: 'Toplam Gol Tek / Çift', cols: 2, sels: [['odd', 'Tek'], ['even', 'Çift']] },
    { key: 'goals_band', label: 'Toplam Gol Aralığı', cols: 4, sels: [['0-1', '0-1'], ['2-3', '2-3'], ['4-5', '4-5'], ['6+', '6+']] },
  ] },
  { title: 'İlk Yarı', open: false, markets: [
    { key: 'iy_1x2', label: 'İlk Yarı Sonucu', cols: 3, sels: [['1', 'Ev (1)'], ['X', 'Berabere (X)'], ['2', 'Dep (2)']] },
    { key: 'iy_ou05', label: 'İlk Yarı Alt/Üst 0.5', cols: 2, sels: [['over', '0.5 Üst'], ['under', '0.5 Alt']] },
    { key: 'iy_ou15', label: 'İlk Yarı Alt/Üst 1.5', cols: 2, sels: [['over', '1.5 Üst'], ['under', '1.5 Alt']] },
    { key: 'iy_btts', label: 'İlk Yarı Karşılıklı Gol', cols: 2, sels: [['yes', 'KG Var'], ['no', 'KG Yok']] },
  ] },
  { title: 'Takım Golleri', open: false, markets: [
    { key: 'h_ou05', label: 'Ev Sahibi Alt/Üst 0.5', cols: 2, sels: [['over', '0.5 Üst'], ['under', '0.5 Alt']] },
    { key: 'h_ou15', label: 'Ev Sahibi Alt/Üst 1.5', cols: 2, sels: [['over', '1.5 Üst'], ['under', '1.5 Alt']] },
    { key: 'h_ou25', label: 'Ev Sahibi Alt/Üst 2.5', cols: 2, sels: [['over', '2.5 Üst'], ['under', '2.5 Alt']] },
    { key: 'a_ou05', label: 'Deplasman Alt/Üst 0.5', cols: 2, sels: [['over', '0.5 Üst'], ['under', '0.5 Alt']] },
    { key: 'a_ou15', label: 'Deplasman Alt/Üst 1.5', cols: 2, sels: [['over', '1.5 Üst'], ['under', '1.5 Alt']] },
    { key: 'a_ou25', label: 'Deplasman Alt/Üst 2.5', cols: 2, sels: [['over', '2.5 Üst'], ['under', '2.5 Alt']] },
  ] },
  { title: 'Kombinasyonlar', open: false, markets: [
    { key: 'ms_ou25', label: 'Maç Sonucu + Alt/Üst 2.5', cols: 3, sels: [
      ['1-ust', '1 & Üst'], ['X-ust', 'X & Üst'], ['2-ust', '2 & Üst'],
      ['1-alt', '1 & Alt'], ['X-alt', 'X & Alt'], ['2-alt', '2 & Alt']] },
    { key: 'ms_btts', label: 'Maç Sonucu + KG', cols: 3, sels: [
      ['1-var', '1 & Var'], ['X-var', 'X & Var'], ['2-var', '2 & Var'],
      ['1-yok', '1 & Yok'], ['X-yok', 'X & Yok'], ['2-yok', '2 & Yok']] },
    { key: 'btts_ou25', label: 'KG + Alt/Üst 2.5', cols: 2, sels: [
      ['var-ust', 'Var & Üst'], ['var-alt', 'Var & Alt'], ['yok-ust', 'Yok & Üst'], ['yok-alt', 'Yok & Alt']] },
  ] },
  { title: 'Kesin Skor', open: false, markets: [
    { key: 'cs', label: 'Kesin Skor', cols: 3, sels: CS_LIST },
  ] },
];

// Etiket haritalarini gruplardan uret
const MARKET_LABELS = {};
const PICK_LABELS = {};
for (const g of MARKET_GROUPS) {
  for (const mk of g.markets) {
    MARKET_LABELS[mk.key] = mk.label;
    PICK_LABELS[mk.key] = {};
    for (const [sk, sl] of mk.sels) PICK_LABELS[mk.key][sk] = sl;
  }
}
const STATUS_LABELS = { pending: 'Bekliyor', won: 'Kazandı', lost: 'Kaybetti', void: 'İptal' };

let ME = null;
let CONFIG = { min_stake: 50, tournament_end: '2027-01-01T00:00:00+03:00', no_bet_penalty: 100 };

// ---------- Auth ekrani ----------
$$('.tab').forEach((t) =>
  t.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    const which = t.dataset.authTab;
    $('#login-form').classList.toggle('hidden', which !== 'login');
    $('#register-form').classList.toggle('hidden', which !== 'register');
    $('#auth-msg').textContent = '';
  })
);

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/login', { method: 'POST', body: { username: f.username.value, password: f.password.value } });
    await boot();
  } catch (err) {
    setAuthMsg(err.message, true);
  }
});

$('#register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const r = await api('/register', { method: 'POST', body: { username: f.username.value, password: f.password.value } });
    setAuthMsg(r.message, false);
    f.reset();
  } catch (err) {
    setAuthMsg(err.message, true);
  }
});

function setAuthMsg(msg, isErr) {
  const el = $('#auth-msg');
  el.textContent = msg;
  el.className = 'auth-msg ' + (isErr ? 'err' : 'ok');
}

$('#logout-btn').addEventListener('click', async () => {
  await api('/logout', { method: 'POST' });
  ME = null;
  location.reload();
});

// ---------- Navigasyon ----------
const VIEWS = ['bulten', 'kuponlarim', 'kullanicilar', 'sonuclar'];
function buildNav() {
  const items = [
    ['bulten', 'Bülten', '⚽'],
    ['kuponlarim', 'Kuponlarım', '🧾'],
    ['kullanicilar', 'Oyuncular', '👥'],
    ['puan', 'Puan', '📊'],
    ['istatistik', 'İstatistik', '📈'],
    ['sonuclar', 'Sonuçlar', '🏁'],
  ];
  if (ME.is_admin) items.push(['admin', 'Admin', '⚙️']);
  $('#nav').innerHTML = items
    .map(([k, l, ic]) => `<button data-view="${k}"><span class="ic">${ic}</span><span class="lb">${l}</span></button>`)
    .join('');
  $$('#nav button').forEach((b) => b.addEventListener('click', () => render(b.dataset.view)));
}

function setActiveNav(view) {
  $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
}

// ---------- Baslangic ----------
async function boot() {
  const { user, config } = await api('/me');
  if (config) CONFIG = config;
  if (!user || user.status !== 'approved') {
    if (user && user.status === 'pending') setAuthMsg('Hesabınız henüz onaylanmadı.', true);
    $('#auth-screen').classList.remove('hidden');
    $('#app').classList.add('hidden');
    return;
  }
  ME = user;
  $('#auth-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#user-chip').textContent = ME.username + (ME.is_admin ? ' (admin)' : '');
  updateBalance(ME.balance);
  buildNav();
  render('bulten');
  // Ucretsiz-guvenli otomatik sonuclandirma: bitmis maclar varsa arka planda tetikle.
  api('/auto-settle', { method: 'POST' })
    .then((r) => {
      if (r && r.ran && ((r.settled || 0) + (r.iyFixed || 0)) > 0) {
        refreshMe();
        render('bulten');
      }
    })
    .catch(() => {});
  // Eksik AI raporlarını arka planda üret; bitince bülten kendini tazeler (rozet çıksın).
  api('/generate-report', { method: 'POST' })
    .then((r) => { if (r && (r.generated || 0) > 0 && CURRENT_VIEW === 'bulten') render('bulten'); })
    .catch(() => {});
}

function updateBalance(b) {
  if (b != null) ME.balance = b;
  $('#balance').textContent = fmtTL(ME.balance);
}

async function refreshMe() {
  const { user } = await api('/me');
  if (user) updateBalance(user.balance);
}

// ---------- Render ----------
let CURRENT_VIEW = 'bulten';
async function render(view) {
  CURRENT_VIEW = view;
  if (view !== 'bulten') stopLivePolling(); // baska sekmeye gecince canli yoklamayi durdur
  setActiveNav(view);
  const el = $('#view');
  el.innerHTML = '<div class="spinner">Yükleniyor…</div>';
  try {
    if (view === 'bulten') await renderBulten(el);
    else if (view === 'kuponlarim') await renderKuponlarim(el);
    else if (view === 'kullanicilar') await renderKullanicilar(el);
    else if (view === 'puan') await renderPuan(el);
    else if (view === 'istatistik') await renderStats(el);
    else if (view === 'sonuclar') await renderSonuclar(el);
    else if (view === 'admin') await renderAdmin(el);
  } catch (err) {
    el.innerHTML = `<div class="empty">Hata: ${err.message}</div>`;
  }
}

// ----- Bülten -----
async function renderBulten(el) {
  const { matches } = await api('/matches');
  if (!matches.length) {
    el.innerHTML = `<div class="empty">Şu an bahis açık maç yok.${ME.is_admin ? ' Admin panelinden maçları güncelleyebilirsin.' : ''}</div>`;
    return;
  }
  el.innerHTML =
    `<div class="disclaimer">🎮 Arkadaşlar arası <b>eğlence oyunu</b> · Gerçek para <b>yoktur</b> · <b>ASCU</b> yalnızca sanal puandır · Bahis/kumar değildir</div>` +
    rulesCard() +
    `<div class="section-title">Maçlar <small>${matches.length} maç</small></div>` +
    matches.map(matchCard).join('') +
    `<p class="foot-tz">Tüm saatler Türkiye saati ile gösterilmektedir · Maça dokun, oranlar açılsın</p>`;
  $$('.report-badge', el).forEach((b) =>
    b.addEventListener('click', (e) => { e.stopPropagation(); openReportPanel(b.dataset.report); })
  );
  $$('.match-lite', el).forEach((row) =>
    row.addEventListener('click', () => openMatchPanel(row.dataset.mid))
  );
  // Baslamis (canli olabilecek) mac varsa canli skoru yoklamaya basla.
  const hasStarted = matches.some((m) => new Date(m.commence_time).getTime() <= Date.now() && m.status === 'open');
  if (hasStarted) startLivePolling(); else stopLivePolling();
}

// ----- İstatistikler (FPL lig geneli listeler) -----
let STATS_DATA = null;
const STAT_CATS = [
  { key: 'gol', label: 'Gol Krallığı', val: (r) => r.g },
  { key: 'asist', label: 'Asist Krallığı', val: (r) => r.a },
  { key: 'katki', label: 'Gol+Asist', val: (r) => r.ga, sub: (r) => `${r.g}G · ${r.a}A` },
  { key: 'form', label: 'En Formda', val: (r) => Number(r.f).toFixed(1), color: true },
  { key: 'puan', label: 'FPL Puanı', val: (r) => r.pt },
  { key: 'kaleci', label: 'Clean Sheet', val: (r) => r.cs, sub: (r) => `${r.sv} kurtarış` },
  { key: 'kart', label: 'Kart', card: true },
];
function statPhoto(code) {
  return code ? `<img src="https://resources.premierleague.com/premierleague/photos/players/110x140/p${code}.png" loading="lazy" alt="" onerror="this.remove()">` : '';
}
function statList(cat, rows) {
  if (!rows || !rows.length) return '<div class="empty">Bu kategoride henüz veri yok (sezon başı olabilir).</div>';
  const sc = cat.color ? { mn: Math.min(...rows.map((r) => Number(r.f))), mx: Math.max(...rows.map((r) => Number(r.f))) } : null;
  const body = rows.map((r, i) => {
    let val;
    if (cat.card) {
      val = `<span class="lb-cards">${r.yc ? `<i class="ycard">${r.yc}</i>` : ''}${r.rc ? `<i class="rcard">${r.rc}</i>` : ''}</span>`;
    } else if (cat.color) {
      const col = srRatColor(Number(r.f), sc) || '#12a05c';
      val = `<span class="lb-val" style="background:${col};color:#fff;border:0">${cat.val(r)}</span>`;
    } else {
      val = `<span class="lb-val">${cat.val(r)}</span>`;
    }
    const sub = cat.sub ? `<small class="lb-sub">${cat.sub(r)}</small>` : '';
    const medal = i < 3 ? ` lb-top${i + 1}` : '';
    return `<div class="lb-row">
      <span class="lb-rank${medal}">${i + 1}</span>
      <span class="lb-ph">${statPhoto(r.c)}</span>
      <span class="lb-nm">${r.n} <small>${r.t}</small>${sub}</span>
      ${val}
    </div>`;
  }).join('');
  return `<div class="lb">${body}</div>`;
}
async function renderStats(el) {
  const data = await api('/stats').catch(() => null);
  if (!data || !data.ok) {
    el.innerHTML = `<div class="empty">İstatistikler şu an alınamadı.${data && data.error ? ` (${data.error})` : ''}</div>`;
    return;
  }
  STATS_DATA = data;
  const gwtxt = data.gw ? `${data.gw}. hafta` : 'güncel';
  el.innerHTML =
    `<div class="section-title">İstatistikler <small>FPL · ${gwtxt}</small></div>`
    + `<div class="stat-tabs">${STAT_CATS.map((c, i) => `<button class="stat-tab${i === 0 ? ' active' : ''}" data-cat="${c.key}">${c.label}</button>`).join('')}</div>`
    + `<div id="stat-list"></div>`
    + `<p class="foot-tz">Kaynak: Fantasy Premier League · yalnızca Premier Lig oyuncuları · ~15 dk'da bir güncellenir</p>`;
  const listEl = $('#stat-list', el);
  const draw = (key) => { const cat = STAT_CATS.find((c) => c.key === key); listEl.innerHTML = statList(cat, STATS_DATA[key]); };
  $$('.stat-tab', el).forEach((b) => b.addEventListener('click', () => {
    $$('.stat-tab', el).forEach((x) => x.classList.toggle('active', x === b));
    draw(b.dataset.cat);
  }));
  draw('gol');
}

// ----- Canli skor: PAYLASIMLI onbellekten okur (10 sn'de bir) -----
let liveTimer = null;
function liveLabel(info) {
  const s = info.status;
  if (s === 'PAUSED') return 'DEVRE ARASI';
  if (s === 'FINISHED') return 'BİTTİ';
  // Dakikayi SADECE veri kaynagi gercekten verirse goster; tahmin etme.
  if (info.minute != null) return `CANLI · ${info.minute}'`;
  return 'CANLI';
}
async function updateLiveScores() {
  try {
    const { live } = await api('/live');
    Object.keys(live || {}).forEach((id) => {
      const info = live[id] || {};
      const el = document.querySelector(`.live-score[data-live="${id}"]`);
      const lbl = document.querySelector(`[data-livelbl="${id}"]`);
      if (el && info.h != null && info.a != null) el.textContent = `${info.h} - ${info.a}`;
      if (lbl) lbl.textContent = liveLabel(info);
    });
  } catch (_) {}
}
function startLivePolling() {
  stopLivePolling();
  updateLiveScores();
  liveTimer = setInterval(() => {
    if (document.hidden) return;      // sekme arkadaysa istek atma (Vercel'i yorma)
    const el = $('#view');
    if (!el || !el.querySelector('.match-live')) { stopLivePolling(); return; }
    updateLiveScores();
  }, 10000);
}
function stopLivePolling() { if (liveTimer) { clearInterval(liveTimer); liveTimer = null; } }
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && liveTimer) updateLiveScores();
});

// Ana sayfadaki "Oyun Kuralları" karti (gruplu tam liste).
function rulesCard() {
  const min = CONFIG.min_stake, pen = CONFIG.no_bet_penalty;
  const groups = [
    ['Puan / Bakiye Kuralları', [
      `Her maç için kupon oynama alt tutar limiti <b>${min} ASCU</b>'dur.`,
      `Turnuva <b>1 Ocak</b> itibarı ile sonuçlanır; bakiyesi en yüksek olan kazanır.`,
      `Kupon oynanmayan ve oynamaya kapatılmış <b>her maç için</b> hesaptan <b>${pen} ASCU</b> düşülür.`,
      `Maç başladıktan sonra o maça bahis oynanamaz (bahis maç başlangıç saniyesinde kapanır).`,
      `Eksi bakiyeye düşülemez; kupon için yeterli bakiye şartı aranır.`,
      `Bakiyesi <b>${min} ASCU</b>'nun altına düşen ve bekleyen kuponu olmayan oyuncunun hesabı <b>"Kaybetti"</b> olarak güncellenir.`,
      `Kupon oynandıktan sonra iptal veya değişiklik yapılamaz.`,
    ]],
    ['Maç Sonucu Kuralları', [
      `Maç belirlenen süre içinde oynanmaz/ertelenirse o maça yapılan bahisler iade edilir.`,
      `Maç yarım kalır veya sonuç resmî olarak kesinleşmezse bahisler iade edilir.`,
      `Maç sonuçları resmî veri kaynağından alınır ve sistemce doğrulanır.`,
      `Sistem bir maçı yanlış sonuçlandırırsa yönetici sonucu düzeltebilir.`,
    ]],
    ['Oyuncu / Davranış Kuralları', [
      `Oyuncular birbirine ASCU borç veremez veya transfer edemez.`,
      `Sistemde açık aramak, hata (bug) ile bakiye artırmak veya başkasının hesabını kullanmak yasaktır.`,
      `Her oyuncu yalnızca kendi hesabından oynar.`,
      `Anlaşmazlık durumunda son karar <b>yöneticiye</b> aittir.`,
      `Kuralları ihlal eden oyuncuya ASCU cezası veya geçici bahis yasağı uygulanabilir.`,
    ]],
  ];
  let n = 0;
  const body = groups.map(([title, items]) =>
    `<div class="rules-sub">${title}</div>` +
    `<ol class="rules-list" start="${n + 1}">` +
    items.map((t) => { n++; return `<li>${t}</li>`; }).join('') +
    `</ol>`
  ).join('');
  return `<details class="rules-card"><summary class="rules-head">📋 Oyun Kuralları</summary>${body}</details>`;
}

function oddBtn(mid, market, sel, label, odd) {
  const disabled = odd ? '' : 'disabled';
  return `<div class="odd-btn ${disabled}" data-mid="${mid}" data-market="${market}" data-sel="${sel}">
    <span class="k">${label}</span><span class="v">${odd ? Number(odd).toFixed(2) : '-'}</span></div>`;
}

// Bultende kompakt mac satiri. Mac basladiysa oranlar yerine CANLI rozeti.
function matchCard(m) {
  const o = m.odds || {};
  const ms = o['1x2'] || {};
  const k = fmtKick(m.commence_time);
  const oneline = (v) => (v ? Number(v).toFixed(2) : '-');
  const started = new Date(m.commence_time).getTime() <= Date.now();
  const mine = Number(m.my_bets) || 0;
  const betBadge = mine > 0
    ? `<div class="bet-done">✓ Kupon yaptınız${mine > 1 ? ` <b>(${mine})</b>` : ''}</div>`
    : '';
  const reportBadge = m.has_report
    ? `<div class="report-badge" data-report="${m.id}" role="button" title="Saha Raporu'nu aç">📋 Saha Raporu hazır<span class="rb-go">Görüntüle ›</span></div>`
    : '';

  const fixture = `
    <div class="fixture">
      <div class="teams-col">
        <div class="team-row">${crestEl(m.home_team)}<span class="team-name">${m.home_team}</span></div>
        <div class="team-row">${crestEl(m.away_team)}<span class="team-name">${m.away_team}</span></div>
      </div>
      <div class="kick"><b>${k.day}</b>${k.time}</div>
      ${started ? '' : '<span class="chev">›</span>'}
    </div>`;

  if (started) {
    return `<div class="match match-live">
      ${betBadge}
      ${reportBadge}
      ${fixture}
      <div class="live-row">
        <span class="live-badge"><span class="live-dot"></span><span data-livelbl="${m.id}">CANLI</span></span>
        <span class="live-note">bahisler kapandı</span>
        <span class="live-score" data-live="${m.id}" data-kick="${new Date(m.commence_time).getTime()}"></span>
      </div>
    </div>`;
  }

  return `<div class="match match-lite" data-mid="${m.id}">
    ${betBadge}
    ${reportBadge}
    ${fixture}
    <div class="lite-ms">
      <span class="ms-pill"><i>1</i>${oneline(ms['1'])}</span>
      <span class="ms-pill"><i>X</i>${oneline(ms.X)}</span>
      <span class="ms-pill"><i>2</i>${oneline(ms['2'])}</span>
      <span class="ms-more">Tüm oranlar ›</span>
    </div>
  </div>`;
}

// Panelde gosterilecek tum bahis pazarlari (gruplu, acilir-kapanir)
function marketsHtml(m) {
  const o = m.odds || {};
  return MARKET_GROUPS.map((g) => {
    const inner = g.markets
      .map((mk) => {
        const mo = o[mk.key] || {};
        const btns = mk.sels.map(([sel, lab]) => oddBtn(m.id, mk.key, sel, lab, mo[sel])).join('');
        return `<div class="market"><div class="market-label">${mk.label}</div><div class="odds-row c${mk.cols}">${btns}</div></div>`;
      })
      .join('');
    return `<div class="mgroup ${g.open ? 'open' : ''}">
      <button type="button" class="mgroup-head">${g.title}<span class="mg-ico">▾</span></button>
      <div class="mgroup-body">${inner}</div>
    </div>`;
  }).join('');
}

// Maca tiklayinca acilan (asagidan kayan) oran paneli
// Maç 1 günden yakınsa gösterilen otomatik önizleme raporu (oran + puan durumu).
function fmtForm(f) {
  if (!f) return '<small style="color:var(--muted)">form yok</small>';
  const map = { W: ['G', 'ok'], D: ['B', 'draw'], L: ['M', 'no'] };
  const arr = f.split(/[^WDL]/i).filter(Boolean).map((c) => c.toUpperCase());
  return arr.map((ch) => { const [lab, cls] = map[ch] || ['?', '']; return `<span class="fdot ${cls}">${lab}</span>`; }).join('') || '<small style="color:var(--muted)">form yok</small>';
}
function teamStand(name, t) {
  if (!t) return `<div class="ts"><div class="ts-name">${name}</div><div class="ts-meta" style="color:var(--muted)">puan durumu yok</div></div>`;
  return `<div class="ts"><div class="ts-name">${name}</div>
    <div class="ts-meta"><b>${t.pos}.</b> sıra · <b>${t.points}</b> puan</div>
    <div class="ts-form">${fmtForm(t.form)}</div></div>`;
}
function matchPreviewHtml(p) {
  if (!p) return '';
  const pr = p.probs, ou = p.ou, kg = p.kg;
  const bar = pr ? `<div class="prev-bar"><i class="s1" style="width:${pr['1']}%"></i><i class="sx" style="width:${pr.X}%"></i><i class="s2" style="width:${pr['2']}%"></i></div>
    <div class="prev-legend"><span>1 <b>%${pr['1']}</b></span><span>X <b>%${pr.X}</b></span><span>2 <b>%${pr['2']}</b></span></div>` : '';
  const sc = (p.scores && p.scores.length) ? `<div class="prev-row"><span class="prev-k">En olası skorlar</span><span class="prev-v">${p.scores.map((s) => `${s.score} <small>%${s.prob}</small>`).join(' · ')}</span></div>` : '';
  const ouRow = ou ? `<div class="prev-row"><span class="prev-k">2.5 Gol</span><span class="prev-v">Üst %${ou.over} · Alt %${ou.under}</span></div>` : '';
  const kgRow = kg ? `<div class="prev-row"><span class="prev-k">Karşılıklı Gol</span><span class="prev-v">Var %${kg.yes} · Yok %${kg.no}</span></div>` : '';
  const stand = (p.home || p.away) ? `<div class="prev-stand">${teamStand(p.home_team, p.home)}${teamStand(p.away_team, p.away)}</div>` : '';
  return `<div class="preview-card">
    <div class="prev-title">📊 Maç Önizlemesi</div>
    ${bar}${sc}${ouRow}${kgRow}${stand}
    <div class="prev-note">Oranlar ve güncel puan durumundan otomatik üretildi · G: galibiyet, B: beraberlik, M: mağlubiyet</div>
  </div>`;
}

// PDF tarzi "Saha Raporu" (koyu/altin) — zamanlanmis gorevin urettigi raporu gosterir.
function srEmptyVal(v) {
  if (v == null) return true;
  const s = String(v).trim();
  if (!s) return true;
  if (/^(veri yok|bilinmiyor|yok|null|undefined|-|—|–|n\/a)$/i.test(s)) return true;
  if (/veri yok|bilinmiyor/i.test(s) && !/\d/.test(s)) return true;
  return false;
}
function srClean(rows) { return (rows || []).filter((r) => Array.isArray(r) && !srEmptyVal(r[1])); }
function srRows(rows) {
  return srClean(rows).map(([k, v]) => {
    // H2H satirindaki maclari alt alta goster (";" ile ayrilmis).
    const isH2H = /h2h|karşıla|karsila/i.test(k);
    const val = isH2H ? String(v).split(/\s*;\s*/).filter(Boolean).join('<br>') : v;
    return `<div class="sr-row${isH2H ? ' sr-row-stack' : ''}"><span class="sr-k">${k}</span><span class="sr-v">${val}</span></div>`;
  }).join('');
}
function srGauge(g) {
  const p = Math.max(0, Math.min(100, Math.round(Number(g.pct) || 0)));
  return `<div class="sr-gauge" style="--p:${p}"><div class="sr-ginner"><div class="sr-gnum">%${p}</div><div class="sr-glbl">${g.label || ''}</div></div></div>`;
}
function srMonthYear(ym) {
  if (!ym || !/^\d{4}-\d{2}/.test(String(ym))) return '';
  const [y, m] = String(ym).split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return isNaN(d) ? '' : d.toLocaleDateString('tr-TR', { month: 'short', year: 'numeric' });
}
// Son 5 maçı ALT ALTA satırlar halinde: sonuç + (rakip skoru · turnuva) + ay/yıl.
function srFormRows(arr) {
  if (!arr || !arr.length) return '<div class="form-na">veri yok</div>';
  return arr.map((x) => {
    const r = typeof x === 'string' ? x : (x && x.r) || '';
    const cls = r === 'G' ? 'g' : r === 'B' ? 'b' : 'm';
    const comp = (x && x.comp) || '';
    const opp = (x && x.opp) || '';
    const sc = (x && x.sc) || '';
    const when = srMonthYear(x && x.when);
    const mid = [opp ? `${opp}${sc ? ` ${sc}` : ''}` : '', comp].filter(Boolean).join(' · ');
    return `<div class="fmatch"><span class="form-dot ${cls}">${r}</span><span class="fmatch-mid">${mid || '&nbsp;'}</span><span class="fmatch-date">${when}</span></div>`;
  }).join('');
}
function srForm(f) {
  if (!f || (!(f.home && f.home.length) && !(f.away && f.away.length))) return '';
  const team = (name, arr) => `<div class="fcol"><div class="fcol-team">${name || ''}</div>${srFormRows(arr)}</div>`;
  return `<div class="sr-sec">SON 5 MAÇ</div>
    <div class="sr-form2">
      ${team(f.homeTeam, f.home)}
      ${team(f.awayTeam, f.away)}
    </div>
    <div class="sr-formlegend"><span><i class="form-dot g">G</i>Galibiyet</span><span><i class="form-dot b">B</i>Beraberlik</span><span><i class="form-dot m">M</i>Mağlubiyet</span><span class="sr-formhint">tüm turnuvalar · en üstte en yeni</span></div>`;
}
function srLastName(n) { const p = String(n || '').trim().split(/\s+/); return p[p.length - 1] || ''; }
function srParseFormation(f) { return String(f || '').split(/[^0-9]+/).map((x) => parseInt(x, 10)).filter((x) => x > 0); }
// Oyuncu isim listesi (kaleci ilk) yerine liste görünümü (yedek).
function srXiList(team, formation, players) {
  const list = (players || []).map((p) => `<li>${p}</li>`).join('');
  return `<div class="sr-xi-col">
    <div class="sr-xi-team">${team || ''}${formation ? ` <span class="sr-xi-form">${formation}</span>` : ''}</div>
    ${list ? `<ol class="sr-xi-list">${list}</ol>` : '<div class="form-na">veri yok</div>'}
  </div>`;
}
// Rating renk skalasi: dusuk=kirmizi, orta=sari, yuksek=yesil (max/min'e gore).
function srRatScale(...arrs) {
  const v = [];
  arrs.forEach((a) => (a || []).forEach((p) => { const r = p && p.rating != null ? Number(p.rating) : NaN; if (!isNaN(r)) v.push(r); }));
  if (!v.length) return null;
  return { mn: Math.min(...v), mx: Math.max(...v) };
}
function srRatColor(rating, sc) {
  if (rating == null) return null;
  const v = Number(rating); if (isNaN(v)) return null;
  let t = (sc && sc.mx > sc.mn) ? (v - sc.mn) / (sc.mx - sc.mn) : 1;
  t = Math.max(0, Math.min(1, t));
  const hue = 4 + t * (132 - 4); // 4=kirmizi → 132=yesil
  return `hsl(${Math.round(hue)},68%,42%)`;
}
// Bir oyuncu karti (foto + numara/isim + renkli okunakli rating) — PL sitesi tarzi.
function srFCard(p, sc) {
  const name = typeof p === 'string' ? p : (p && p.name) || '';
  const code = p && p.code;
  const img = code ? `<img class="pf-ph" src="https://resources.premierleague.com/premierleague/photos/players/110x140/p${code}.png" loading="lazy" alt="" onerror="this.remove()">` : '';
  const col = srRatColor(p && p.rating, sc);
  const rat = (p && p.rating != null) ? `<div class="pf-rt" style="background:${col || '#12a05c'}">${p.rating}</div>` : '';
  const num = (p && p.num) ? `<span class="pf-no">${p.num}</span> ` : '';
  return `<div class="pf-ph-wrap">${img}</div>${rat}<div class="pf-nm">${num}${name}</div>`;
}
// Bir takimin oyuncularini dizilise gore satirlara + y konumlarina ayirir.
// top=true → kaleci en ustte (ev sahibi, asagi hucum); top=false → kaleci en altta (deplasman, yukari hucum).
function srPitchRows(players, formation, top) {
  const lines = srParseFormation(formation);
  const pl = players || [];
  if (lines.reduce((a, b) => a + b, 0) !== 10 || pl.length < 11) return null;
  const gk = pl[0]; let idx = 1; const bands = [];
  for (const k of lines) { bands.push(pl.slice(idx, idx + k)); idx += k; } // [D, O, F]
  const rows = top ? [[gk], ...bands] : [...bands.slice().reverse(), [gk]];
  const n = rows.length;
  const y0 = top ? 6 : 57, y1 = top ? 43 : 92;
  return rows.map((row, i) => ({ y: y0 + i * ((y1 - y0) / (n - 1)), row }));
}
// Iki takimi TEK saha uzerinde gosterir (beyaz saha — PL sitesi gibi).
function srPitchBoth(l) {
  const homeRows = srPitchRows(l.home, l.homeFormation, true);
  const awayRows = srPitchRows(l.away, l.awayFormation, false);
  if (!homeRows || !awayRows) return null;
  const sc = srRatScale(l.home, l.away);
  let chips = '';
  const place = (rows) => rows.forEach(({ y, row }) => row.forEach((p, j) => {
    const left = (j + 1) / (row.length + 1) * 100;
    chips += `<div class="pf" style="left:${left}%;top:${y}%">${srFCard(p, sc)}</div>`;
  }));
  place(homeRows); place(awayRows);
  const L = 'rgba(15,20,40,.10)';
  const svg = `<svg class="pf-lines" viewBox="0 0 100 160" preserveAspectRatio="none">`
    + `<rect x="1" y="1" width="98" height="158" fill="none" stroke="${L}" stroke-width="0.5"/>`
    + `<line x1="1" y1="80" x2="99" y2="80" stroke="${L}" stroke-width="0.5"/>`
    + `<circle cx="50" cy="80" r="12" fill="none" stroke="${L}" stroke-width="0.5"/>`
    + `<rect x="26" y="1" width="48" height="22" fill="none" stroke="${L}" stroke-width="0.5"/>`
    + `<rect x="40" y="1" width="20" height="9" fill="none" stroke="${L}" stroke-width="0.5"/>`
    + `<rect x="26" y="137" width="48" height="22" fill="none" stroke="${L}" stroke-width="0.5"/>`
    + `<rect x="40" y="150" width="20" height="9" fill="none" stroke="${L}" stroke-width="0.5"/></svg>`;
  return `<div class="sr-fpitch">${svg}${chips}</div>`;
}
// Pozisyona göre gruplu OKUNAKLI liste (kaleci/defans/orta/forvet).
function srLineupList(team, formation, players, srcTag, sc) {
  const pl = (players || []).filter(Boolean);
  const tag = srcTag === 'ai' ? '<span class="sr-src-tag ai">AI tahmini</span>'
    : srcTag === 'fpl' ? '<span class="sr-src-tag ok">güncel</span>' : '';
  const head = `<div class="sr-xi-team">${team || ''}${tag}</div>`;
  if (pl.length < 11) return `<div class="sr-xi-col">${head}<div class="form-na">veri yok</div></div>`;
  const lines = srParseFormation(formation);
  const gk = pl[0]; let idx = 1;
  const pos = ['D', 'O', 'F']; // Defans / Orta Saha / Forvet
  const rows = [['K', gk]]; // her oyuncu AYRI satır
  lines.forEach((k, i) => { pl.slice(idx, idx + k).forEach((n) => rows.push([pos[i] || '-', n])); idx += k; });
  const body = rows.map(([p, n]) => {
    const name = typeof n === 'string' ? n : (n && n.name) || '';
    const col = srRatColor(n && n.rating, sc);
    const rating = (n && n.rating != null) ? `<span class="pl-rat" style="background:${col || '#12a05c'}">${n.rating}</span>` : '';
    return `<div class="pl-row"><span class="pl-pos">${p}</span><span class="pl-name">${name}</span>${rating}</div>`;
  }).join('');
  return `<div class="sr-xi-col">${head}<div class="pl-list">${body}</div></div>`;
}
function srLineups(l) {
  if (!l || (!(l.home && l.home.length) && !(l.away && l.away.length))) return '';
  const hs = l.homeSrc || (l.src === 'ai' ? 'ai' : 'fpl');
  const as = l.awaySrc || (l.src === 'ai' ? 'ai' : 'fpl');
  const head = `<div class="sr-sec">MUHTEMEL İLK 11 <span class="sr-xi-tag">kesin değil</span></div>`;
  const note = `<div class="sr-note">Resmi FPL kadrosundan (bu sezon en çok oynayanlar) kuruldu. Diziliş <b>yaklaşıktır</b> (oyuncular doğru, tam mevkiler tahmini). Oyuncunun altındaki renkli rozet = <b>FPL form</b> — bu maçtaki oyuncular arasında <b style="color:#128a4e">yüksek=yeşil</b>, <b style="color:#c0392b">düşük=kırmızı</b> (son maçların ort. fantezi puanı; gerçek maç rating'i değildir). Kesin 11 maçtan ~1 saat önce belli olur.</div>`;
  const sc = srRatScale(l.home, l.away);
  const legend = sc ? `<div class="sr-ratleg"><span class="rl-t">FPL form</span><span class="rl-v">${sc.mn.toFixed(1)}</span><i class="rl-bar"></i><span class="rl-v">${sc.mx.toFixed(1)}</span></div>` : '';
  const both = srPitchBoth(l);
  if (both) {
    const hform = l.homeFormation ? ` <span class="ft-form">${l.homeFormation}</span>` : '';
    const aform = l.awayFormation ? ` <span class="ft-form">${l.awayFormation}</span>` : '';
    return head
      + `<div class="ft-hd ft-top"><span class="ft-nm">${l.homeTeam || ''}</span>${hform}</div>`
      + both
      + `<div class="ft-hd ft-bot"><span class="ft-nm">${l.awayTeam || ''}</span>${aform}</div>`
      + legend
      + note;
  }
  // Diziliş çözülemezse okunaklı liste görünümü.
  return head
    + `<div class="sr-lineups">${srLineupList(l.homeTeam, l.homeFormation, l.home, hs, sc)}${srLineupList(l.awayTeam, l.awayFormation, l.away, as, sc)}</div>`
    + legend
    + note;
}
function sahaReportHtml(r, m) {
  if (!r) return '';
  const meta = r.meta || {};
  const metaLine = [meta.league, meta.week, meta.date, meta.stadium].filter(Boolean).join(' · ');
  const S = (t) => `<div class="sr-sec">${t}</div>`;
  return `<div class="saha">
    <div class="sr-title">SAHA RAPORU</div>
    ${metaLine ? `<div class="sr-meta">${metaLine}</div>` : ''}
    <div class="sr-teams"><span class="sr-tn">${m.home_team}</span><span class="sr-vs">VS</span><span class="sr-tn sr-right">${m.away_team}</span></div>
    ${r.intro ? `<p class="sr-p">${r.intro}</p>` : ''}
    ${srClean(r.data).length ? S('MAÇ VERİLERİ') + srRows(r.data) : ''}
    ${r.gauges && r.gauges.length ? `<div class="sr-gauges">${r.gauges.map(srGauge).join('')}</div>` : ''}
    ${r.conclusion ? `<div class="sr-concl"><div class="sr-cl">RAPORUN SONUCU</div><div class="sr-ct">${r.conclusion.title || ''}</div>${r.conclusion.note ? `<div class="sr-cn">${r.conclusion.note}</div>` : ''}</div>` : ''}
    ${r.form ? srForm(r.form) : ''}
    ${srClean(r.extras).length ? S('EK VERİLER') + srRows(r.extras) : ''}
    ${r.why ? S('NEDEN BU SONUÇ?') + `<p class="sr-p">${r.why}</p>` : ''}
    ${r.lineups ? srLineups(r.lineups) : ''}
    ${r.footer ? `<div class="sr-foot">${r.footer}${r.gen && r.gen.at ? ` · üretim: ${String(r.gen.by || '')} ${new Date(r.gen.at).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ })}` : ''}${r.gen && r.gen.fpl ? `<br><span style="opacity:.7">FPL: ${r.gen.fpl.loaded ? `yüklendi(${r.gen.fpl.teams}) · ev=${r.gen.fpl.home}[${r.gen.fpl.hk || ''}] · dep=${r.gen.fpl.away}[${r.gen.fpl.ak || ''}]` : 'YÜKLENEMEDİ (Vercel FPL erişemedi)'}</span>` : ''}</div>` : ''}
  </div>`;
}

async function openMatchPanel(mid) {
  const { matches } = await api('/matches');
  const m = matches.find((x) => x.id === mid);
  if (!m) return toast('Maç bulunamadı', true);
  const k = fmtKick(m.commence_time);
  const kt = new Date(m.commence_time).getTime();
  // Saha Raporu artik AYRI panelde acilir; oran panelinde sadece "Gör" butonu durur.
  const hasReport = !!m.has_report;
  const reportBtn = hasReport
    ? `<button type="button" class="saha-open-btn" id="open-saha" data-mid="${mid}">📋 Saha Raporu'nu Gör</button>`
    : '';
  // Rapor yoksa ve maça 1 günden az kaldıysa hafif önizleme göster.
  let previewHtml = '';
  if (!hasReport && kt > Date.now() && kt - Date.now() <= 86400000) {
    try { const p = await api(`/matches/${mid}/preview`); previewHtml = matchPreviewHtml(p); } catch (_) {}
  }
  $('#match-content').innerHTML = `
    <div class="panel-head">
      <div class="teams-col">
        <div class="team-row">${crestEl(m.home_team)}<span class="team-name">${m.home_team}</span></div>
        <div class="team-row">${crestEl(m.away_team)}<span class="team-name">${m.away_team}</span></div>
      </div>
      <div class="kick"><b>${k.day}</b>${k.time}</div>
    </div>
    ${reportBtn}
    ${previewHtml}
    ${marketsHtml(m)}`;
  if ($('#open-saha')) $('#open-saha').addEventListener('click', () => { closeMatchPanel(); openReportPanel(mid); });
  $$('#match-content .mgroup-head').forEach((h) =>
    h.addEventListener('click', () => h.parentElement.classList.toggle('open'))
  );
  $$('#match-content .odd-btn').forEach((b) =>
    b.addEventListener('click', () => {
      closeMatchPanel();
      openBet(b.dataset.mid, b.dataset.market, b.dataset.sel);
    })
  );
  $('#match-modal').scrollTop = 0;
  $('#match-modal').classList.remove('hidden');
}
function closeMatchPanel() {
  $('#match-modal').classList.add('hidden');
}

// ----- Saha Raporu paneli (oranlardan ayri, kendi modalinda) -----
async function openReportPanel(mid) {
  const { matches } = await api('/matches');
  const m = matches.find((x) => x.id === mid);
  if (!m) return toast('Maç bulunamadı', true);
  $('#report-content').innerHTML = '<div class="sr-loading">Saha Raporu yükleniyor…</div>';
  $('#report-modal').scrollTop = 0;
  $('#report-modal').classList.remove('hidden');
  try {
    const p = await api(`/matches/${mid}/preview`);
    if (p.report && Object.keys(p.report).length) {
      $('#report-content').innerHTML = sahaReportHtml(p.report, m);
    } else {
      $('#report-content').innerHTML = '<div class="empty">Bu maç için Saha Raporu henüz hazır değil.</div>';
    }
  } catch (_) {
    $('#report-content').innerHTML = '<div class="empty">Saha Raporu yüklenemedi.</div>';
  }
  $('#report-modal').scrollTop = 0;
}
function closeReportPanel() {
  $('#report-modal').classList.add('hidden');
}

// ----- Kupon paneli -----
let BULTEN_CACHE = {};
async function openBet(mid, market, sel) {
  const { matches } = await api('/matches');
  const m = matches.find((x) => x.id === mid);
  if (!m) return toast('Maç bulunamadı', true);
  const odd = m.odds && m.odds[market] && m.odds[market][sel];
  if (!odd) return toast('Oran mevcut değil', true);

  $('#bet-content').innerHTML = `
    <div class="bet-teams">${m.home_team} vs ${m.away_team}</div>
    <div class="bet-pick">${MARKET_LABELS[market]} · ${PICK_LABELS[market][sel]} · Oran ${Number(odd).toFixed(2)}</div>
    <div class="bet-field">
      <label>Bahis tutarı (ASCU) — Bakiye: ${fmtTL(ME.balance)} · Min. ${CONFIG.min_stake}</label>
      <input id="stake-input" type="number" min="${CONFIG.min_stake}" step="1" placeholder="En az ${CONFIG.min_stake}" inputmode="numeric" />
      <div class="quick">
        <button data-q="50">50</button><button data-q="100">100</button>
        <button data-q="250">250</button><button data-q="500">500</button>
      </div>
    </div>
    <div class="bet-summary"><span>Olası kazanç</span><b id="pot-win">0 ASCU</b></div>
    <button class="btn-primary" id="place-bet">Kuponu Onayla</button>`;

  const stakeInput = $('#stake-input');
  const potWin = $('#pot-win');
  const calc = () => {
    const s = Number(stakeInput.value) || 0;
    potWin.textContent = fmtTL(Math.round(s * odd * 100) / 100);
  };
  stakeInput.addEventListener('input', calc);
  $$('#bet-content .quick button').forEach((q) =>
    q.addEventListener('click', () => {
      stakeInput.value = q.dataset.q;
      calc();
    })
  );
  $('#place-bet').addEventListener('click', async () => {
    const btn = $('#place-bet');
    if (btn.disabled) return; // cift tiklama koruması (istek devam ederken tekrar gonderme)
    const stake = Number(stakeInput.value);
    if (!stake || stake <= 0) return toast('Geçerli bir tutar girin', true);
    if (stake < CONFIG.min_stake) return toast(`Minimum kupon tutarı ${CONFIG.min_stake} ASCU`, true);
    btn.disabled = true;
    const oldLabel = btn.textContent;
    btn.textContent = 'Oluşturuluyor…';
    try {
      const r = await api('/coupons', { method: 'POST', body: { match_id: mid, market, selection: sel, stake } });
      if (r.balance != null) updateBalance(r.balance);
      closeBet();
      toast('Kupon oluşturuldu! ✅');
    } catch (err) {
      // Cift gonderim sunucuda engellendiyse kullaniciyi bilgilendir ama korkutma.
      const d = (err && err.data) || {};
      if (d.duplicate || /çift gönderim|zaten oluştur/i.test((err && err.message) || '')) {
        if (d.balance != null) updateBalance(d.balance);
        closeBet();
        toast('Bu kupon zaten oluşturulmuştu (çift gönderim engellendi).');
      } else {
        toast(err.message, true);
      }
    } finally {
      btn.disabled = false;
      btn.textContent = oldLabel;
    }
  });

  $('#bet-modal').classList.remove('hidden');
}
function closeBet() {
  $('#bet-modal').classList.add('hidden');
}
$('#bet-close').addEventListener('click', closeBet);
$('#bet-modal').addEventListener('click', (e) => {
  if (e.target.id === 'bet-modal') closeBet();
});
$('#match-close').addEventListener('click', closeMatchPanel);
$('#match-modal').addEventListener('click', (e) => {
  if (e.target.id === 'match-modal') closeMatchPanel();
});
if ($('#report-close')) $('#report-close').addEventListener('click', closeReportPanel);
if ($('#report-modal')) $('#report-modal').addEventListener('click', (e) => {
  if (e.target.id === 'report-modal') closeReportPanel();
});

// ----- Kuponlarim -----
async function renderKuponlarim(el) {
  const { coupons } = await api('/coupons/mine');
  if (!coupons.length) {
    el.innerHTML = '<div class="empty">Henüz kupon yapmadın. Bülten\'den bir maç seç!</div>';
    return;
  }
  el.innerHTML = `<div class="section-title">Kuponlarım <small>${coupons.length} kupon</small></div>` + coupons.map(couponCard).join('');
  wireCouponCancels(el, async () => { await refreshMe(); renderKuponlarim(el); });
}

function couponCard(c) {
  const st = c.status;
  const score = c.status !== 'pending' && c.home_score != null ? ` · Skor: ${c.home_score}-${c.away_score}` : '';
  return `<div class="coupon ${st}">
    <div class="coupon-top">
      <div>
        <div class="coupon-teams">${c.home_team} vs ${c.away_team}</div>
        <div class="coupon-pick">${MARKET_LABELS[c.market]} · ${PICK_LABELS[c.market][c.selection]} @ ${Number(c.odd).toFixed(2)}</div>
      </div>
      <span class="status-badge ${st}">${STATUS_LABELS[st]}</span>
    </div>
    <div class="coupon-meta">
      <span>Bahis: <b>${fmtTL(c.stake)}</b></span>
      <span>Olası: <b>${fmtTL(c.potential_win)}</b></span>
      <span>${fmtDate(c.commence_time)}${score}</span>
    </div>
    ${c.created_at ? `<div class="coupon-stamp" title="Kuponun oynanma zamanı (saniyeye kadar)">🕒 Oynanma: ${fmtStamp(c.created_at)}</div>` : ''}
    ${(ME.is_admin && c.status === 'pending') ? `<button class="btn-sm btn-no coupon-cancel" data-cid="${c.id}" style="margin-top:8px">✕ Kuponu İptal Et (iade)</button>` : ''}
  </div>`;
}
// Admin: kupon iptal butonlarini bagla (iptal edilince iade + listeyi tazele).
function wireCouponCancels(el, onDone) {
  if (!ME.is_admin) return;
  $$('.coupon-cancel', el).forEach((b) => b.addEventListener('click', async () => {
    if (b.disabled) return;
    if (!confirm('Bu kupon iptal edilecek ve yatırılan tutar oyuncuya iade edilecek. Emin misin?')) return;
    b.disabled = true;
    try {
      const r = await api(`/admin/coupons/${b.dataset.cid}/cancel`, { method: 'POST' });
      toast(`Kupon iptal edildi, ${fmtTL(r.refunded)} iade edildi ✅`);
      if (typeof onDone === 'function') onDone();
    } catch (e) { toast(e.message, true); b.disabled = false; }
  }));
}

// ----- Kullanicilar -----
function statsLine(u) {
  return `<div class="user-stats">
    <span class="ust ok" title="Kazanan kupon">✅ ${u.won}</span>
    <span class="ust no" title="Kaybeden kupon">❌ ${u.lost}</span>
    <span class="ust wait" title="Bekleyen kupon">⏳ ${u.pending}</span>
    <span class="ust miss" title="Kaçırılan (kupon yapılmayan) maç">🚫 ${u.missed}</span>
    <span class="ust odds" title="Tutturulan toplam oran">🎯 ${Number(u.won_odds || 0).toFixed(2)}</span>
  </div>`;
}

// Ikon aciklamalari (tablonun ustunde tek satir).
function statLegend() {
  return `<div class="stat-legend">
    <span>✅ Kazanan</span><span>❌ Kaybeden</span><span>⏳ Bekleyen</span>
    <span>🚫 Kaçırılan maç</span><span>🎯 Toplam oran</span></div>`;
}

function championCard(u, leaderDays) {
  const you = u.id === ME.id ? '<span class="you-badge">SEN</span>' : '';
  const elim = u.eliminated ? '<span class="elim-tag">Kaybetti</span>' : '';
  const days = Number(leaderDays) || 0;
  const total = Number(u.leader_total_days) || 0;
  const daysTxt = days >= 1 ? `🔥 ${days} gündür lider` : 'bugün lider oldu';
  const totalTxt = total >= 1 ? `<span class="champ-total"><span class="logo-ico cat-bg"></span> toplam ${total} gün lider</span>` : '';
  return `<div class="champion" data-uid="${u.id}">
    <div class="champ-glow"></div>
    <span class="champ-logo cat-bg" role="img" aria-label="Premier Lig"></span>
    <div class="champ-name">${u.username}${u.is_admin ? '<span class="admin-tag">admin</span>' : ''}${you}${elim}</div>
    <div class="champ-bal">${fmtTL(u.balance)}</div>
    <div class="champ-days">${daysTxt}</div>
    ${totalTxt}
    ${statsLine(u)}
  </div>`;
}

function playerRow(u, rank, leadBal) {
  const bal = Number(u.balance) || 0;
  const pct = leadBal > 0 ? Math.max(3, Math.round((bal / leadBal) * 100)) : 0;
  const gap = Math.round(leadBal - bal);
  const medal = rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
  const you = u.id === ME.id ? ' <span class="you-tag">(sen)</span>' : '';
  const elim = u.eliminated ? '<span class="elim-tag">Kaybetti</span>' : '';
  return `<div class="prow${u.eliminated ? ' user-elim' : ''}${u.id === ME.id ? ' prow-you' : ''}" data-uid="${u.id}">
    <div class="prow-top">
      <div class="prow-left">
        <div class="rank ${medal}">${rank}</div>
        <div class="pinfo">
          <div class="uname">${u.username}${u.is_admin ? '<span class="admin-tag">admin</span>' : ''}${elim}${you}${Number(u.leader_total_days) >= 1 ? `<span class="lead-badge" title="Toplam liderlik süresi"><span class="logo-ico cat-bg"></span>${u.leader_total_days}g</span>` : ''}${Number(u.last_total_days) >= 1 ? `<span class="last-badge" title="Toplam sonunculuk süresi">${BUCKET_SVG}${u.last_total_days}g</span>` : ''}</div>
          <div class="pgap">Lidere fark: <b>-${fmtTL(gap)}</b></div>
        </div>
      </div>
      <div class="ubalance">${fmtTL(u.balance)}</div>
    </div>
    <div class="race"><i style="width:${pct}%"></i></div>
    ${statsLine(u)}
  </div>`;
}

async function renderKullanicilar(el) {
  const { users, leaderDays } = await api('/users');
  if (!users.length) { el.innerHTML = '<div class="empty">Henüz oyuncu yok.</div>'; return; }
  const leadBal = Number(users[0].balance) || 0;
  const rest = users.slice(1).map((u, i) => playerRow(u, i + 2, leadBal)).join('');
  el.innerHTML =
    `<div class="section-title">🏆 Şampiyonluk Yarışı <small>1 Ocak'ta bakiyesi en yüksek olan kazanır</small></div>` +
    statLegend() +
    championCard(users[0], leaderDays) +
    rest;
  $$('.champion, .prow', el).forEach((r) => r.addEventListener('click', () => renderUserDetail(r.dataset.uid)));
}

async function renderUserDetail(uid) {
  const el = $('#view');
  el.innerHTML = '<div class="spinner">Yükleniyor…</div>';
  const { user, coupons, stats } = await api('/users/' + uid);
  const couponsHtml = coupons.length ? coupons.map(couponCard).join('') : '<div class="empty">Bu oyuncu henüz kupon yapmamış.</div>';

  const adminHtml = ME.is_admin ? `
    <div class="card">
      <h3>⚙️ Admin İşlemleri</h3>
      <div class="bet-field" style="margin-bottom:12px">
        <label>Bakiye düzenle (ASCU)</label>
        <div style="display:flex;gap:8px">
          <input id="adm-balance" type="number" min="0" step="1" value="${Number(user.balance)}" style="flex:1;background:var(--bg);border:1px solid var(--line);color:var(--text);padding:11px;border-radius:8px;font-size:15px" />
          <button class="btn-sm btn-ok" id="adm-balance-save">Kaydet</button>
        </div>
      </div>
      ${user.id !== ME.id
        ? '<button class="btn-sm btn-no" id="adm-delete">🗑️ Kullanıcıyı Sil</button>'
        : '<div style="color:var(--muted);font-size:12px">(Kendi hesabını silemezsin)</div>'}
    </div>` : '';

  el.innerHTML = `
    <button class="btn-ghost" id="back-btn" style="margin-bottom:14px">← Oyuncular</button>
    <div class="card">
      <h3>${user.username}${user.is_admin ? '<span class="admin-tag">admin</span>' : ''}${user.eliminated ? '<span class="elim-tag">Kaybetti</span>' : ''}</h3>
      <div class="coupon-meta" style="margin:0">
        <span>Bakiye: <b style="color:var(--gold)">${fmtTL(user.balance)}</b></span>
        <span>Toplam kupon: <b>${stats.total}</b></span>
        <span style="color:var(--accent)">Kazanan: <b>${stats.won}</b></span>
        <span style="color:var(--danger)">Kaybeden: <b>${stats.lost}</b></span>
        <span style="color:var(--warn)">Bekleyen: <b>${stats.pending}</b></span>
      </div>
    </div>
    ${adminHtml}
    <div class="section-title">Kuponları</div>
    ${couponsHtml}`;

  $('#back-btn').addEventListener('click', () => render('kullanicilar'));
  wireCouponCancels(el, async () => { await refreshMe(); renderUserDetail(uid); });

  if (ME.is_admin) {
    $('#adm-balance-save').addEventListener('click', async () => {
      const balance = Number($('#adm-balance').value);
      if (!Number.isFinite(balance) || balance < 0) return toast('Geçerli bir bakiye girin', true);
      try {
        await api(`/admin/users/${uid}/balance`, { method: 'POST', body: { balance } });
        toast('Bakiye güncellendi ✅');
        if (Number(uid) === ME.id) await refreshMe();
        renderUserDetail(uid);
      } catch (e) { toast(e.message, true); }
    });
    const delBtn = $('#adm-delete');
    if (delBtn) delBtn.addEventListener('click', async () => {
      if (!confirm(`${user.username} kullanıcısı ve tüm kuponları kalıcı olarak silinecek. Emin misin?`)) return;
      try {
        await api(`/admin/users/${uid}/delete`, { method: 'POST' });
        toast('Kullanıcı silindi');
        render('kullanicilar');
      } catch (e) { toast(e.message, true); }
    });
  }
}

// ----- Puan Durumu (gercek Premier Lig tablosu) -----
async function renderPuan(el) {
  let data;
  try {
    data = await api('/standings');
  } catch (e) {
    const msg = String(e.message || '');
    const tokenIssue = /token/i.test(msg) || /invalid/i.test(msg) || /\b40[013]\b/.test(msg) || /gerekli/i.test(msg);
    let hint = '';
    if (ME.is_admin) {
      hint = tokenIssue
        ? `<br><small style="color:var(--muted)">Admin: <b>football-data API anahtarı geçersiz</b> görünüyor. Vercel → Settings → Environment Variables → <code>FOOTBALL_DATA_TOKEN</code> değerini kontrol et (boşluksuz, Odds API anahtarıyla karıştırma) ve <b>yeniden Deploy</b> et.</small>`
        : `<br><small style="color:var(--muted)">Admin: ${msg}</small>`;
    }
    el.innerHTML = `<div class="empty">Puan durumu şu an gösterilemiyor.${hint}</div>`;
    return;
  }
  const table = data.table || [];
  if (!table.length) {
    el.innerHTML = '<div class="empty">Puan durumu verisi bulunamadı.</div>';
    return;
  }
  const rows = table
    .map((r) => {
      const zone = r.pos <= 4 ? 'ucl' : r.pos <= 5 ? 'uel' : r.pos >= 18 ? 'rel' : '';
      const gd = r.gd > 0 ? '+' + r.gd : String(r.gd);
      return `<tr class="pd-row ${zone}">
        <td class="pd-pos">${r.pos}</td>
        <td class="pd-team">${crestEl(r.full || r.team)}<span class="pd-name">${r.team}</span></td>
        <td>${r.played}</td>
        <td class="pd-hide">${r.won}</td>
        <td class="pd-hide">${r.draw}</td>
        <td class="pd-hide">${r.lost}</td>
        <td>${gd}</td>
        <td class="pd-pts">${r.points}</td>
      </tr>`;
    })
    .join('');
  el.innerHTML = `
    <div class="section-title">Puan Durumu <small>Premier Lig</small></div>
    <div class="pd-wrap">
      <table class="pd-table">
        <thead><tr>
          <th>#</th><th style="text-align:left">Takım</th>
          <th>O</th><th class="pd-hide">G</th><th class="pd-hide">B</th><th class="pd-hide">M</th>
          <th>AV</th><th>P</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="pd-legend">
      <span><i class="dot ucl"></i>Şampiyonlar Ligi</span>
      <span><i class="dot uel"></i>Avrupa Ligi</span>
      <span><i class="dot rel"></i>Küme düşme</span>
    </div>
    <p class="foot-tz">Kaynak: football-data.org · O: oynanan, G: galibiyet, B: beraberlik, M: mağlubiyet, AV: averaj, P: puan</p>`;
}

// ----- Sonuclar -----
function goalNames(list) {
  return (list || []).map((x) => (x.n > 1 ? `${x.name} (${x.n})` : x.name)).join(', ');
}
function sonucDetail(m) {
  const voided = m.status === 'void';
  if (voided) return '<div class="rd-row"><span class="rd-k">Durum</span><span class="rd-v">Maç iptal edildi</span></div>';
  const hasIY = m.ht_home != null && m.ht_away != null;
  const iy = hasIY ? `${m.ht_home} - ${m.ht_away}` : '—';
  const sh = hasIY ? `${m.home_score - m.ht_home} - ${m.away_score - m.ht_away}` : '—';
  const g = m.goals;
  // Ev sahibi golleri = ev golcüleri + deplasman kendi kalesine; tam tersi deplasman için.
  const homeScorers = g ? [...(g.homeGoals || []), ...(g.awayOG || []).map((x) => ({ name: `${x.name} (k.k.)`, n: x.n }))] : [];
  const awayScorers = g ? [...(g.awayGoals || []), ...(g.homeOG || []).map((x) => ({ name: `${x.name} (k.k.)`, n: x.n }))] : [];
  let goalsBlock = '';
  if (g) {
    const hg = goalNames(homeScorers), ag = goalNames(awayScorers);
    const ha = goalNames(g.homeAssists), aa = goalNames(g.awayAssists);
    goalsBlock =
      `<div class="rd-goals">
        <div class="rd-team">
          <div class="rd-tn">${m.home_team}</div>
          <div class="rd-line"><span class="rd-ico">⚽</span> ${hg || '<i>gol yok</i>'}</div>
          ${ha ? `<div class="rd-line rd-ast"><span class="rd-ico">🅰️</span> ${ha}</div>` : ''}
        </div>
        <div class="rd-team">
          <div class="rd-tn">${m.away_team}</div>
          <div class="rd-line"><span class="rd-ico">⚽</span> ${ag || '<i>gol yok</i>'}</div>
          ${aa ? `<div class="rd-line rd-ast"><span class="rd-ico">🅰️</span> ${aa}</div>` : ''}
        </div>
      </div>
      <div class="rd-note">Golcü ve asist: resmi FPL verisi · gol dakikası ücretsiz kaynakta yok</div>`;
  } else {
    goalsBlock = '<div class="rd-note">Golcü/asist bilgisi henüz gelmedi (FPL maçı işledikçe otomatik dolar).</div>';
  }
  return `<div class="rd-scores">
      <span class="rd-chip">İY <b>${iy}</b></span>
      <span class="rd-chip">2.Y <b>${sh}</b></span>
      <span class="rd-chip rd-ms">MS <b>${m.home_score} - ${m.away_score}</b></span>
    </div>${goalsBlock}`;
}
async function renderSonuclar(el) {
  const { matches } = await api('/matches/results');
  if (!matches.length) {
    el.innerHTML = '<div class="empty">Henüz sonuçlanan maç yok.</div>';
    return;
  }
  el.innerHTML =
    `<div class="section-title">Sonuçlar <small>son maçlar · dokun, detay açılsın</small></div>` +
    matches
      .map((m, i) => {
        const voided = m.status === 'void';
        const score = voided ? 'İPTAL' : `${m.home_score} - ${m.away_score}`;
        const hasIY = m.ht_home != null && m.ht_away != null;
        const iy = voided
          ? ''
          : `<div class="iy-line">İY: ${hasIY ? `<b>${m.ht_home} - ${m.ht_away}</b>` : '<span class="iy-missing">—</span>'}</div>`;
        return `<div class="match res-card">
          <div class="res-head" data-ri="${i}">
            <div class="fixture">
              <div class="teams-col">
                <div class="team-row">${crestEl(m.home_team)}<span class="team-name">${m.home_team}</span></div>
                <div class="team-row">${crestEl(m.away_team)}<span class="team-name">${m.away_team}</span></div>
              </div>
              <div class="score-col">
                <div class="kick" style="font-size:20px;font-weight:800;color:${voided ? 'var(--muted)' : 'var(--pri)'}">${score}</div>
                ${iy}
              </div>
            </div>
            <div class="res-head-b"><span class="market-label">${fmtDate(m.commence_time)}</span><span class="res-arrow" aria-hidden="true">▾</span></div>
          </div>
          <div class="res-detail" id="rd-${i}" hidden>${sonucDetail(m)}</div>
        </div>`;
      })
      .join('');
  $$('.res-head', el).forEach((h) => h.addEventListener('click', () => {
    const card = h.closest('.res-card');
    const d = $('#rd-' + h.dataset.ri, el);
    const open = card.classList.toggle('open');
    d.hidden = !open;
  }));
}

// ----- Admin -----
async function renderAdmin(el) {
  const [{ pending }, { matches }, resultsResp] = await Promise.all([
    api('/admin/pending'), api('/matches'), api('/matches/results'),
  ]);
  const settledMatches = (resultsResp.matches || []).filter((m) => m.status === 'settled');

  const pendingHtml = pending.length
    ? pending
        .map(
          (u) => `<div class="pending-row">
            <span>${u.username} <small style="color:var(--muted)">${fmtDate(u.created_at)}</small></span>
            <div class="row-actions">
              <button class="btn-sm btn-ok" data-approve="${u.id}">Onayla</button>
              <button class="btn-sm btn-no" data-reject="${u.id}">Reddet</button>
            </div>
          </div>`
        )
        .join('')
    : '<div style="color:var(--muted);font-size:13px">Bekleyen kayıt yok.</div>';

  const matchesHtml = matches.length
    ? matches
        .map(
          (m) => `<div class="pending-row" style="flex-wrap:wrap">
            <span>${m.home_team} vs ${m.away_team} <small style="color:var(--muted)">${fmtDate(m.commence_time)}</small></span>
            <form class="settle-form" data-mid="${m.id}">
              <span style="font-size:11px;color:var(--muted);width:100%">Maç sonu skoru:</span>
              <input type="number" min="0" placeholder="0" class="hs" />
              <span>-</span>
              <input type="number" min="0" placeholder="0" class="as" />
              <span style="font-size:11px;color:var(--muted);width:100%;margin-top:4px">İlk yarı skoru (isteğe bağlı):</span>
              <input type="number" min="0" placeholder="İY" class="ihs" />
              <span>-</span>
              <input type="number" min="0" placeholder="İY" class="ias" />
              <button type="submit" class="btn-sm btn-blue">Sonuçlandır</button>
              <button type="button" class="btn-sm btn-no" data-void="${m.id}">İptal</button>
            </form>
          </div>`
        )
        .join('')
    : '<div style="color:var(--muted);font-size:13px">Açık maç yok.</div>';

  // KURAL 8: Sonuclanan maclarin duzeltilmesi (yeniden sonuclandirma).
  const correctHtml = settledMatches.length
    ? settledMatches
        .map(
          (m) => `<div class="pending-row" style="flex-wrap:wrap">
            <span>${m.home_team} vs ${m.away_team} <small style="color:var(--muted)">şu an: ${m.home_score}-${m.away_score}</small></span>
            <form class="correct-form" data-mid="${m.id}">
              <span style="font-size:11px;color:var(--muted);width:100%">Doğru maç sonu skoru:</span>
              <input type="number" min="0" placeholder="0" class="chs" />
              <span>-</span>
              <input type="number" min="0" placeholder="0" class="cas" />
              <span style="font-size:11px;color:var(--muted);width:100%;margin-top:4px">İlk yarı (isteğe bağlı):</span>
              <input type="number" min="0" placeholder="İY" class="cihs" />
              <span>-</span>
              <input type="number" min="0" placeholder="İY" class="cias" />
              <button type="submit" class="btn-sm btn-blue">Düzelt</button>
            </form>
          </div>`
        )
        .join('')
    : '<div style="color:var(--muted);font-size:13px">Sonuçlanmış maç yok.</div>';

  el.innerHTML = `
    <div class="info-banner">
      <b>Admin paneli.</b> Kullanıcıları onayla, canlı maç/oranları çek, sonuçları işle.
      Canlı veri için sunucuda <code>ODDS_API_KEY</code> tanımlı olmalı; değilse maçları elle sonuçlandırabilirsin.
    </div>

    <div class="card">
      <h3>Bekleyen Üyelikler (${pending.length})</h3>
      <div id="pending-list">${pendingHtml}</div>
    </div>

    <div class="card">
      <h3>Canlı Veri</h3>
      <div class="admin-tools">
        <button class="btn-sm btn-blue" id="refresh-matches">Maçları & Oranları Çek</button>
        <button class="btn-sm btn-blue" id="refresh-results">Sonuçları Çek & Hesapla</button>
      </div>
      <div id="admin-msg" style="margin-top:10px;font-size:13px;color:var(--muted)"></div>
    </div>

    <div class="card">
      <h3>Maçları Elle Sonuçlandır</h3>
      <div id="settle-list">${matchesHtml}</div>
    </div>

    <div class="card">
      <h3>🤖 Saha Raporu (AI)</h3>
      <p style="color:var(--muted);font-size:13px;line-height:1.5;margin-bottom:10px">
        Yaklaşan maçlar için raporu <b>otomatik</b> üretir. Oranlar siteden; hakem/H2H football-data'dan; xG/form Understat'tan; muhtemel 11 ve sakatlar resmi FPL'den. Her gün gece 00:00'da kendi de çalışır.
      </p>
      <div class="admin-tools" style="margin-bottom:6px">
        <button class="btn-sm btn-blue" id="ai-gen">🤖 Eksik Raporları Üret</button>
        <button class="btn-sm btn-ok" id="ai-refresh">🔄 Tüm Raporları Yenile</button>
        <button class="btn-sm" id="af-check" style="background:var(--bg);border:1px solid var(--line);color:var(--ink)">🔎 API-Football Kontrol</button>
      </div>
      <div id="ai-msg" style="margin:6px 0 12px;font-size:13px;color:var(--muted)"></div>
      <pre id="af-msg" style="margin:6px 0 12px;font-size:11px;color:var(--muted);white-space:pre-wrap;word-break:break-word"></pre>
      <p style="color:var(--muted);font-size:12px;line-height:1.5;margin-bottom:10px">
        Elle de ekleyebilirsin: maçı seç, JSON yapıştır, kaydet.
      </p>
      <select id="rep-match" style="width:100%;background:var(--bg);border:1px solid var(--line);color:var(--ink);padding:10px;border-radius:8px;font-size:14px;margin-bottom:8px">
        ${matches.map((m) => `<option value="${m.id}">${m.home_team} - ${m.away_team}</option>`).join('')}
      </select>
      <textarea id="rep-json" rows="6" placeholder='{"meta":{...},"intro":"...","data":[...],...}' style="width:100%;background:var(--bg);border:1px solid var(--line);color:var(--ink);padding:10px;border-radius:8px;font-size:12px;font-family:monospace"></textarea>
      <div class="admin-tools" style="margin-top:8px">
        <button class="btn-sm btn-ok" id="rep-save">Raporu Kaydet</button>
        <button class="btn-sm btn-no" id="rep-del">Raporu Sil</button>
      </div>
      <div id="rep-msg" style="margin-top:8px;font-size:13px;color:var(--muted)"></div>
    </div>

    <div class="card">
      <h3>✏️ Sonucu Düzelt (Kural 8)</h3>
      <p style="color:var(--muted);font-size:13px;line-height:1.5;margin-bottom:12px">
        Yanlış sonuçlanan maçı doğru skorla yeniden hesaplar. Kuponlar yeni skora göre
        tekrar değerlendirilir; katılım cezası (Kural 3) tekrar uygulanmaz.
      </p>
      <div id="correct-list">${correctHtml}</div>
    </div>

    <div class="card">
      <h3>🔄 Sezonu Sıfırla</h3>
      <p style="color:var(--muted);font-size:13px;line-height:1.5;margin-bottom:12px">
        Tüm kuponları siler ve <b>herkesin bakiyesini 1.000 ASCU'ya</b> döndürür.
        Kullanıcı hesapları <b>silinmez</b>. Geri alınamaz.
      </p>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted);margin-bottom:12px">
        <input type="checkbox" id="reset-matches" /> Sonuçlanan maçları da tekrar bahse aç
      </label>
      <button class="btn-sm btn-no" id="reset-btn">Kuponları & Bakiyeleri Sıfırla</button>
      <div id="reset-msg" style="margin-top:10px;font-size:13px;color:var(--muted)"></div>
    </div>`;

  // Onay/Red
  $$('[data-approve]', el).forEach((b) =>
    b.addEventListener('click', async () => {
      await api(`/admin/users/${b.dataset.approve}/approve`, { method: 'POST' });
      toast('Kullanıcı onaylandı ✅');
      render('admin');
    })
  );
  $$('[data-reject]', el).forEach((b) =>
    b.addEventListener('click', async () => {
      await api(`/admin/users/${b.dataset.reject}/reject`, { method: 'POST' });
      toast('Kullanıcı reddedildi');
      render('admin');
    })
  );

  // Canli veri
  $('#refresh-matches').addEventListener('click', async () => {
    const msg = $('#admin-msg');
    msg.textContent = 'Çekiliyor…';
    try {
      const r = await api('/admin/refresh-matches', { method: 'POST' });
      msg.textContent = `${r.count} maç güncellendi.`;
      toast('Maçlar güncellendi ✅');
    } catch (e) {
      msg.textContent = e.message;
    }
  });
  $('#refresh-results').addEventListener('click', async () => {
    const msg = $('#admin-msg');
    msg.textContent = 'Çekiliyor…';
    try {
      const r = await api('/admin/refresh-results', { method: 'POST' });
      let html = `<b>${r.settled}</b> maç doğrulandı ve sonuçlandı.`;
      if (r.iyFixed) html += ` <b>${r.iyFixed}</b> maçın ilk yarı skoru tamamlandı.`;
      if (r.fdActive === false) {
        html += ' <span style="color:var(--muted)">(çift doğrulama kapalı — FOOTBALL_DATA_TOKEN eklenmemiş; ilk yarı kuponları iade edildi)</span>';
      }
      if (r.conflicts && r.conflicts.length) {
        html += `<div style="margin-top:10px;background:#fce4ea;border:1px solid #f6d3de;border-radius:8px;padding:10px 12px;color:#9c2c4a">
          <b>⚠️ ${r.conflicts.length} maçta skor doğrulanamadı — aşağıdan elle sonuçlandır:</b>` +
          r.conflicts.map((c) => `<div style="margin-top:6px">• <b>${c.teams}</b><br><span style="font-size:12px">football-data: <b>${c.fd}</b> · Odds API: <b>${c.odds}</b> · <i>${c.reason}</i></span></div>`).join('') +
          `</div>`;
      }
      if (r.fdError) html += `<div style="margin-top:8px;color:var(--danger);font-size:12px">football-data notu: ${r.fdError}</div>`;
      msg.innerHTML = html;
      toast('Sonuçlar işlendi ✅');
      await refreshMe();
    } catch (e) {
      msg.textContent = e.message;
    }
  });

  // Sezonu sifirla
  $('#reset-btn').addEventListener('click', async () => {
    if (!confirm('TÜM kuponlar silinecek ve herkesin bakiyesi 1.000 ASCU olacak. Emin misin?')) return;
    const msg = $('#reset-msg');
    msg.textContent = 'Sıfırlanıyor…';
    try {
      const alsoMatches = $('#reset-matches').checked;
      await api('/admin/reset', { method: 'POST', body: { matches: alsoMatches } });
      toast('Sıfırlandı ✅');
      await refreshMe();
      render('admin');
    } catch (e) {
      msg.textContent = e.message;
    }
  });

  // Elle sonuclandirma
  $$('.settle-form', el).forEach((f) =>
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const hs = Number($('.hs', f).value);
      const as = Number($('.as', f).value);
      if (!Number.isInteger(hs) || !Number.isInteger(as)) return toast('Maç sonu skorunu girin', true);
      const ihv = $('.ihs', f).value, iav = $('.ias', f).value;
      const body = { home_score: hs, away_score: as };
      if (ihv !== '' && iav !== '') { body.ht_home = Number(ihv); body.ht_away = Number(iav); }
      try {
        await api(`/admin/matches/${f.dataset.mid}/settle`, { method: 'POST', body });
        toast('Maç sonuçlandı ✅');
        render('admin');
      } catch (err) {
        toast(err.message, true);
      }
    })
  );
  // KURAL 8: Sonuc duzeltme
  $$('.correct-form', el).forEach((f) =>
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const hs = Number($('.chs', f).value);
      const as = Number($('.cas', f).value);
      if (!Number.isInteger(hs) || !Number.isInteger(as)) return toast('Doğru skoru girin', true);
      const ihv = $('.cihs', f).value, iav = $('.cias', f).value;
      const body = { home_score: hs, away_score: as, correct: true };
      if (ihv !== '' && iav !== '') { body.ht_home = Number(ihv); body.ht_away = Number(iav); }
      if (!confirm('Bu maçın sonucunu düzeltmek istediğine emin misin? Kuponlar yeniden hesaplanacak.')) return;
      try {
        await api(`/admin/matches/${f.dataset.mid}/settle`, { method: 'POST', body });
        toast('Sonuç düzeltildi ✅');
        render('admin');
      } catch (err) {
        toast(err.message, true);
      }
    })
  );
  $$('[data-void]', el).forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await api(`/admin/matches/${b.dataset.void}/void`, { method: 'POST' });
        toast('Maç iptal edildi, bahisler iade edildi');
        render('admin');
      } catch (err) {
        toast(err.message, true);
      }
    })
  );

  // AI ile eksik raporları üret
  if ($('#ai-gen')) $('#ai-gen').addEventListener('click', async () => {
    const am = $('#ai-msg');
    am.style.color = 'var(--muted)'; am.textContent = 'Üretiliyor… (birkaç dakika sürebilir, sayfada kal)';
    try {
      const r = await api('/admin/generate-reports', { method: 'POST' });
      if (r.error) { am.style.color = 'var(--danger)'; am.textContent = r.error; return; }
      let t = `${r.generated || 0} rapor üretildi.`;
      if (r.skipped === 'locked') t = 'Şu an başka bir üretim sürüyor, birazdan tekrar dene.';
      if (r.errors && r.errors.length) t += ' Hatalar: ' + r.errors.join(' | ');
      am.style.color = (r.errors && r.errors.length) ? 'var(--danger)' : 'var(--ok)';
      am.textContent = t;
      toast('AI rapor üretimi bitti');
    } catch (e) { am.style.color = 'var(--danger)'; am.textContent = e.message; }
  });

  if ($('#ai-refresh')) $('#ai-refresh').addEventListener('click', async () => {
    const btn = $('#ai-refresh'); const am = $('#ai-msg');
    if (btn.disabled) return;
    if (!confirm('Tüm yaklaşan maçların raporu yeniden üretilecek (mevcut olanlar güncel verilerle yenilenir). Devam?')) return;
    btn.disabled = true; const old = btn.textContent; btn.textContent = 'Yenileniyor…';
    am.style.color = 'var(--muted)'; am.textContent = 'Raporlar yenileniyor… (birkaç dakika sürebilir, sayfada kal)';
    try {
      const r = await api('/admin/refresh-reports', { method: 'POST' });
      if (r.error) { am.style.color = 'var(--danger)'; am.textContent = r.error; return; }
      if (r.skipped === 'locked') { am.textContent = 'Şu an başka bir üretim sürüyor, birazdan tekrar dene.'; return; }
      let t = `${r.generated || 0} rapor yenilendi.`;
      if (r.remaining) t += ` ${r.remaining} maç kaldı — tamamlamak için tekrar “Tüm Raporları Yenile”ye bas.`;
      if (r.errors && r.errors.length) t += ' Hatalar: ' + r.errors.join(' | ');
      am.style.color = (r.errors && r.errors.length) ? 'var(--danger)' : 'var(--ok)';
      am.textContent = t;
      toast(r.remaining ? 'Kısmi yenilendi, tekrar bas' : 'Tüm raporlar güncellendi');
    } catch (e) { am.style.color = 'var(--danger)'; am.textContent = e.message; }
    finally { btn.disabled = false; btn.textContent = old; }
  });

  if ($('#af-check')) $('#af-check').addEventListener('click', async () => {
    const fm = $('#af-msg');
    fm.style.color = 'var(--muted)'; fm.textContent = 'API-Football kontrol ediliyor…';
    try {
      const r = await api('/admin/apifootball-check');
      fm.textContent = JSON.stringify(r, null, 2);
    } catch (e) { fm.style.color = 'var(--danger)'; fm.textContent = e.message; }
  });

  // Saha Raporu yapıştır / kaydet / sil
  const repMsg = $('#rep-msg');
  if ($('#rep-save')) $('#rep-save').addEventListener('click', async () => {
    const id = $('#rep-match').value;
    let report;
    try { report = JSON.parse($('#rep-json').value); }
    catch (e) { repMsg.style.color = 'var(--danger)'; repMsg.textContent = 'JSON hatalı: ' + e.message; return; }
    try {
      await api(`/admin/report/${id}`, { method: 'POST', body: { report } });
      repMsg.style.color = 'var(--ok)'; repMsg.textContent = 'Rapor kaydedildi ✅ Maça dokununca görünür.';
      toast('Saha Raporu kaydedildi ✅');
    } catch (err) { repMsg.style.color = 'var(--danger)'; repMsg.textContent = err.message; }
  });
  if ($('#rep-del')) $('#rep-del').addEventListener('click', async () => {
    const id = $('#rep-match').value;
    try {
      await api(`/admin/report/${id}/delete`, { method: 'POST' });
      $('#rep-json').value = '';
      repMsg.style.color = 'var(--muted)'; repMsg.textContent = 'Rapor silindi.';
      toast('Rapor silindi');
    } catch (err) { repMsg.style.color = 'var(--danger)'; repMsg.textContent = err.message; }
  });
}

// ---------- Acilis animasyonu kaldir ----------
(function dismissSplash() {
  const s = document.getElementById('splash');
  if (!s) return;
  setTimeout(() => {
    s.classList.add('hide');
    document.body.classList.remove('loading');
    setTimeout(() => s.remove(), 500);
  }, 3050);
})();

// ---------- Baslat ----------
boot().catch(() => {
  $('#auth-screen').classList.remove('hidden');
});
