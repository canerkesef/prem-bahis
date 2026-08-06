'use strict';

// ---------- Yardimcilar ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Bir hata olustu');
  return data;
}

function fmtTL(n) {
  return Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' TL';
}
const TZ = 'Europe/Istanbul';
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ });
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

const PICK_LABELS = {
  '1x2': { '1': 'Ev Sahibi (1)', X: 'Beraberlik (X)', '2': 'Deplasman (2)' },
  dc: { '1x': '1 veya X', '12': '1 veya 2', x2: 'X veya 2' },
  ou15: { over: '1.5 Üst', under: '1.5 Alt' },
  ou25: { over: '2.5 Üst', under: '2.5 Alt' },
  ou35: { over: '3.5 Üst', under: '3.5 Alt' },
  oe: { odd: 'Tek', even: 'Çift' },
  btts: { yes: 'KG Var', no: 'KG Yok' },
  hcap: { '1': 'Ev -1', X: 'Beraberlik (-1)', '2': 'Deplasman +1' },
};
const MARKET_LABELS = {
  '1x2': 'Maç Sonucu',
  dc: 'Çifte Şans',
  ou15: 'Alt / Üst 1.5',
  ou25: 'Alt / Üst 2.5',
  ou35: 'Alt / Üst 3.5',
  oe: 'Toplam Gol Tek / Çift',
  btts: 'Karşılıklı Gol',
  hcap: 'Handikap (Ev -1)',
};
const STATUS_LABELS = { pending: 'Bekliyor', won: 'Kazandı', lost: 'Kaybetti', void: 'İptal' };

let ME = null;

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
    ['bulten', 'Bülten'],
    ['kuponlarim', 'Kuponlarım'],
    ['kullanicilar', 'Oyuncular'],
    ['sonuclar', 'Sonuçlar'],
  ];
  if (ME.is_admin) items.push(['admin', 'Admin']);
  $('#nav').innerHTML = items
    .map(([k, l]) => `<button data-view="${k}">${l}</button>`)
    .join('');
  $$('#nav button').forEach((b) => b.addEventListener('click', () => render(b.dataset.view)));
}

function setActiveNav(view) {
  $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
}

// ---------- Baslangic ----------
async function boot() {
  const { user } = await api('/me');
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
async function render(view) {
  setActiveNav(view);
  const el = $('#view');
  el.innerHTML = '<div class="spinner">Yükleniyor…</div>';
  try {
    if (view === 'bulten') await renderBulten(el);
    else if (view === 'kuponlarim') await renderKuponlarim(el);
    else if (view === 'kullanicilar') await renderKullanicilar(el);
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
    `<div class="section-title">Maçlar <small>${matches.length} maç</small></div>` +
    matches.map(matchCard).join('') +
    `<p class="foot-tz">Tüm saatler Türkiye saati ile gösterilmektedir · Maça dokun, oranlar açılsın</p>`;
  $$('.match-lite', el).forEach((row) =>
    row.addEventListener('click', () => openMatchPanel(row.dataset.mid))
  );
}

function oddBtn(mid, market, sel, label, odd) {
  const disabled = odd ? '' : 'disabled';
  return `<div class="odd-btn ${disabled}" data-mid="${mid}" data-market="${market}" data-sel="${sel}">
    <span class="k">${label}</span><span class="v">${odd ? Number(odd).toFixed(2) : '-'}</span></div>`;
}

// Bultende kompakt, tiklanabilir mac satiri
function matchCard(m) {
  const o = m.odds;
  const k = fmtKick(m.commence_time);
  const oneline = (v) => (v ? Number(v).toFixed(2) : '-');
  return `<div class="match match-lite" data-mid="${m.id}">
    <div class="fixture">
      <div class="teams-col">
        <div class="team-row">${crestEl(m.home_team)}<span class="team-name">${m.home_team}</span></div>
        <div class="team-row">${crestEl(m.away_team)}<span class="team-name">${m.away_team}</span></div>
      </div>
      <div class="kick"><b>${k.day}</b>${k.time}</div>
      <span class="chev">›</span>
    </div>
    <div class="lite-ms">
      <span class="ms-pill"><i>1</i>${oneline(o['1x2']['1'])}</span>
      <span class="ms-pill"><i>X</i>${oneline(o['1x2'].X)}</span>
      <span class="ms-pill"><i>2</i>${oneline(o['1x2']['2'])}</span>
      <span class="ms-more">+7 seçenek ›</span>
    </div>
  </div>`;
}

// Panelde gosterilecek tum bahis pazarlari
function marketsHtml(m) {
  const o = m.odds;
  return `
    <div class="market">
      <div class="market-label">Maç Sonucu</div>
      <div class="odds-row c3">
        ${oddBtn(m.id, '1x2', '1', '1', o['1x2']['1'])}
        ${oddBtn(m.id, '1x2', 'X', 'X', o['1x2'].X)}
        ${oddBtn(m.id, '1x2', '2', '2', o['1x2']['2'])}
      </div>
    </div>
    <div class="market">
      <div class="market-label">Çifte Şans</div>
      <div class="odds-row c3">
        ${oddBtn(m.id, 'dc', '1x', '1-X', o.dc['1x'])}
        ${oddBtn(m.id, 'dc', '12', '1-2', o.dc['12'])}
        ${oddBtn(m.id, 'dc', 'x2', 'X-2', o.dc.x2)}
      </div>
    </div>
    <div class="market">
      <div class="market-label">Handikap (Ev -1)</div>
      <div class="odds-row c3">
        ${oddBtn(m.id, 'hcap', '1', 'Ev -1', o.hcap['1'])}
        ${oddBtn(m.id, 'hcap', 'X', 'Ber. (-1)', o.hcap.X)}
        ${oddBtn(m.id, 'hcap', '2', 'Dep +1', o.hcap['2'])}
      </div>
    </div>
    <div class="market">
      <div class="market-label">Alt / Üst 1.5</div>
      <div class="odds-row c2">
        ${oddBtn(m.id, 'ou15', 'over', '1.5 Üst', o.ou15.over)}
        ${oddBtn(m.id, 'ou15', 'under', '1.5 Alt', o.ou15.under)}
      </div>
    </div>
    <div class="market">
      <div class="market-label">Alt / Üst 2.5</div>
      <div class="odds-row c2">
        ${oddBtn(m.id, 'ou25', 'over', '2.5 Üst', o.ou25.over)}
        ${oddBtn(m.id, 'ou25', 'under', '2.5 Alt', o.ou25.under)}
      </div>
    </div>
    <div class="market">
      <div class="market-label">Alt / Üst 3.5</div>
      <div class="odds-row c2">
        ${oddBtn(m.id, 'ou35', 'over', '3.5 Üst', o.ou35.over)}
        ${oddBtn(m.id, 'ou35', 'under', '3.5 Alt', o.ou35.under)}
      </div>
    </div>
    <div class="market">
      <div class="market-label">Karşılıklı Gol</div>
      <div class="odds-row c2">
        ${oddBtn(m.id, 'btts', 'yes', 'KG Var', o.btts.yes)}
        ${oddBtn(m.id, 'btts', 'no', 'KG Yok', o.btts.no)}
      </div>
    </div>
    <div class="market">
      <div class="market-label">Toplam Gol Tek / Çift</div>
      <div class="odds-row c2">
        ${oddBtn(m.id, 'oe', 'odd', 'Tek', o.oe.odd)}
        ${oddBtn(m.id, 'oe', 'even', 'Çift', o.oe.even)}
      </div>
    </div>`;
}

// Maca tiklayinca acilan (asagidan kayan) oran paneli
async function openMatchPanel(mid) {
  const { matches } = await api('/matches');
  const m = matches.find((x) => x.id === mid);
  if (!m) return toast('Maç bulunamadı', true);
  const k = fmtKick(m.commence_time);
  $('#match-content').innerHTML = `
    <div class="panel-head">
      <div class="teams-col">
        <div class="team-row">${crestEl(m.home_team)}<span class="team-name">${m.home_team}</span></div>
        <div class="team-row">${crestEl(m.away_team)}<span class="team-name">${m.away_team}</span></div>
      </div>
      <div class="kick"><b>${k.day}</b>${k.time}</div>
    </div>
    ${marketsHtml(m)}`;
  $$('#match-content .odd-btn').forEach((b) =>
    b.addEventListener('click', () => {
      closeMatchPanel();
      openBet(b.dataset.mid, b.dataset.market, b.dataset.sel);
    })
  );
  $('#match-modal').classList.remove('hidden');
}
function closeMatchPanel() {
  $('#match-modal').classList.add('hidden');
}

// ----- Kupon paneli -----
let BULTEN_CACHE = {};
async function openBet(mid, market, sel) {
  const { matches } = await api('/matches');
  const m = matches.find((x) => x.id === mid);
  if (!m) return toast('Maç bulunamadı', true);
  const odd = m.odds[market][sel];
  if (!odd) return toast('Oran mevcut değil', true);

  $('#bet-content').innerHTML = `
    <div class="bet-teams">${m.home_team} vs ${m.away_team}</div>
    <div class="bet-pick">${MARKET_LABELS[market]} · ${PICK_LABELS[market][sel]} · Oran ${Number(odd).toFixed(2)}</div>
    <div class="bet-field">
      <label>Bahis tutarı (TL) — Bakiye: ${fmtTL(ME.balance)}</label>
      <input id="stake-input" type="number" min="1" step="1" placeholder="Örn. 100" inputmode="numeric" />
      <div class="quick">
        <button data-q="50">50</button><button data-q="100">100</button>
        <button data-q="250">250</button><button data-q="500">500</button>
      </div>
    </div>
    <div class="bet-summary"><span>Olası kazanç</span><b id="pot-win">0 TL</b></div>
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
    const stake = Number(stakeInput.value);
    if (!stake || stake <= 0) return toast('Geçerli bir tutar girin', true);
    try {
      const r = await api('/coupons', { method: 'POST', body: { match_id: mid, market, selection: sel, stake } });
      updateBalance(r.balance);
      closeBet();
      toast('Kupon oluşturuldu! ✅');
    } catch (err) {
      toast(err.message, true);
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

// ----- Kuponlarim -----
async function renderKuponlarim(el) {
  const { coupons } = await api('/coupons/mine');
  if (!coupons.length) {
    el.innerHTML = '<div class="empty">Henüz kupon yapmadın. Bülten\'den bir maç seç!</div>';
    return;
  }
  el.innerHTML = `<div class="section-title">Kuponlarım <small>${coupons.length} kupon</small></div>` + coupons.map(couponCard).join('');
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
  </div>`;
}

// ----- Kullanicilar -----
async function renderKullanicilar(el) {
  const { users } = await api('/users');
  el.innerHTML =
    `<div class="section-title">Oyuncular <small>bakiyeye göre sıralı</small></div>` +
    users
      .map((u, i) => {
        const goldRank = i === 0 ? 'gold' : '';
        return `<div class="user-row" data-uid="${u.id}">
          <div class="user-left">
            <div class="rank ${goldRank}">${i + 1}</div>
            <div class="uname">${u.username}${u.is_admin ? '<span class="admin-tag">admin</span>' : ''}${u.id === ME.id ? ' <span style="color:var(--muted);font-size:12px">(sen)</span>' : ''}</div>
          </div>
          <div class="ubalance">${fmtTL(u.balance)}</div>
        </div>`;
      })
      .join('');
  $$('.user-row', el).forEach((r) => r.addEventListener('click', () => renderUserDetail(r.dataset.uid)));
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
        <label>Bakiye düzenle (TL)</label>
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
      <h3>${user.username}${user.is_admin ? '<span class="admin-tag">admin</span>' : ''}</h3>
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

// ----- Sonuclar -----
async function renderSonuclar(el) {
  const { matches } = await api('/matches/results');
  if (!matches.length) {
    el.innerHTML = '<div class="empty">Henüz sonuçlanan maç yok.</div>';
    return;
  }
  el.innerHTML =
    `<div class="section-title">Sonuçlar <small>son maçlar</small></div>` +
    matches
      .map((m) => {
        const voided = m.status === 'void';
        const score = voided ? 'İPTAL' : `${m.home_score} - ${m.away_score}`;
        return `<div class="match">
          <div class="fixture">
            <div class="teams-col">
              <div class="team-row">${crestEl(m.home_team)}<span class="team-name">${m.home_team}</span></div>
              <div class="team-row">${crestEl(m.away_team)}<span class="team-name">${m.away_team}</span></div>
            </div>
            <div class="kick" style="font-size:20px;font-weight:800;color:${voided ? 'var(--muted)' : 'var(--pri)'}">${score}</div>
          </div>
          <div class="market-label" style="margin-top:8px">${fmtDate(m.commence_time)}</div>
        </div>`;
      })
      .join('');
}

// ----- Admin -----
async function renderAdmin(el) {
  const [{ pending }, { matches }] = await Promise.all([api('/admin/pending'), api('/matches')]);

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
              <input type="number" min="0" placeholder="0" class="hs" />
              <span>-</span>
              <input type="number" min="0" placeholder="0" class="as" />
              <button type="submit" class="btn-sm btn-blue">Sonuçlandır</button>
              <button type="button" class="btn-sm btn-no" data-void="${m.id}">İptal</button>
            </form>
          </div>`
        )
        .join('')
    : '<div style="color:var(--muted);font-size:13px">Açık maç yok.</div>';

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
      msg.textContent = `${r.settled} maç sonuçlandı, kuponlar hesaplandı.`;
      toast('Sonuçlar işlendi ✅');
      await refreshMe();
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
      if (!Number.isInteger(hs) || !Number.isInteger(as)) return toast('Skor girin', true);
      try {
        await api(`/admin/matches/${f.dataset.mid}/settle`, { method: 'POST', body: { home_score: hs, away_score: as } });
        toast('Maç sonuçlandı ✅');
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
}

// ---------- Baslat ----------
boot().catch(() => {
  $('#auth-screen').classList.remove('hidden');
});
