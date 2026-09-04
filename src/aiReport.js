'use strict';

// Sunucu tarafinda (Vercel) UCRETSIZ AI ile "Saha Raporu" uretir.
// - Sayisal veriler (oran, ihtimal, en olasi skorlar, 2.5/KG) SITENIN markets'inden.
// - Sakat oyuncu, H2H, hakem, stadyum: API-Football (ucretsiz plan).
// - xG ve yazili analiz: Google Gemini (ucretsiz) + Google Search grounding.
// Hicbir alan uydurulmaz; bulunamayan alan "veri yok".
const { sql } = require('./db');
const { normName } = require('./oddsApi');

const GEMINI_SEARCH = process.env.AI_WEB_SEARCH !== '0';
let RESOLVED_MODEL = null; // ilk calisan {ver, model} bulununca onbellege alinir
const AF_BASE = 'https://v3.football.api-sports.io';
const AF_LEAGUE = 39; // Premier League

function parseMk(v) {
  if (!v) return {};
  if (typeof v === 'string') { try { return JSON.parse(v); } catch (_) { return {}; } }
  return v;
}
const pct = (x) => Math.round(x * 1000) / 10;
function normSet(obj, keys) {
  if (!obj) return null;
  const inv = keys.map((k) => (obj[k] ? 1 / Number(obj[k]) : 0));
  const s = inv.reduce((a, b) => a + b, 0);
  if (!s) return null;
  const o = {}; keys.forEach((k, i) => { o[k] = pct(inv[i] / s); }); return o;
}
function deriveNumbers(markets) {
  const mk = parseMk(markets);
  const ms = mk['1x2'] || {};
  const oddsLine = [ms['1'], ms.X, ms['2']].every((x) => x)
    ? `${Number(ms['1']).toFixed(2)} · ${Number(ms.X).toFixed(2)} · ${Number(ms['2']).toFixed(2)}` : null;
  const ou = normSet(mk['ou25'], ['over', 'under']);
  const kg = normSet(mk['btts'], ['yes', 'no']);
  let scores = [];
  if (mk['cs']) {
    const e = Object.entries(mk['cs']).filter(([k, v]) => k !== 'diger' && Number(v) > 0);
    scores = e.map(([k, v]) => [k, 1 / Number(v)]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  }
  return { oddsLine, ou, kg, scores };
}

// ---------- API-Football (ucretsiz veri) ----------
function seasonOf(iso) { const d = new Date(iso); return d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; }
async function afGet(path) {
  const key = (process.env.APIFOOTBALL_KEY || '').trim();
  if (!key) return null;
  const res = await fetch(`${AF_BASE}${path}`, { headers: { 'x-apisports-key': key } });
  if (!res.ok) throw new Error(`API-Football ${res.status}`);
  const j = await res.json();
  return j.response || [];
}
// Takim ID'sini isimle bul (sezondan bagimsiz; ucretsiz planda guncel sezon
// kapali olsa bile calisir). H2H gecmisi bu ID'lerle cekilebilir.
async function afTeamId(name) {
  try {
    const q = encodeURIComponent(String(name).replace(/ FC$/i, '').trim());
    const r = await afGet(`/teams?search=${q}`) || [];
    if (!r.length) return null;
    const nn = normName(name);
    const hit = r.find((t) => normName(t.team.name) === nn)
      || r.find((t) => normName(t.team.name).includes(nn.slice(0, 5))) || r[0];
    return hit && hit.team ? hit.team.id : null;
  } catch (_) { return null; }
}
async function fetchFacts(match) {
  const facts = { referee: null, stadium: null, injuries: null, h2h: [], h2h_note: null };
  if (!(process.env.APIFOOTBALL_KEY || '').trim()) return facts;
  const hn = normName(match.home_team), an = normName(match.away_team);
  let hid = null, aid = null, fx = null;
  // 1) Guncel maci tarih+sezon ile bulmaya calis (hakem/stadyum/sakat icin fixture gerek).
  try {
    const date = new Date(match.commence_time).toISOString().slice(0, 10);
    const season = seasonOf(match.commence_time);
    const fixtures = await afGet(`/fixtures?date=${date}&league=${AF_LEAGUE}&season=${season}`) || [];
    fx = fixtures.find((f) => normName(f.teams.home.name) === hn && normName(f.teams.away.name) === an)
      || fixtures.find((f) => normName(f.teams.home.name).includes(hn.slice(0, 5)) && normName(f.teams.away.name).includes(an.slice(0, 5))) || null;
    if (fx) {
      facts.referee = fx.fixture.referee || null;
      facts.stadium = (fx.fixture.venue && fx.fixture.venue.name) || null;
      hid = fx.teams.home.id; aid = fx.teams.away.id;
    }
  } catch (_) {}
  // 2) Fixture bulunamadiysa (ucretsiz plan guncel sezonu kapatiyor olabilir) takim
  //    ID'lerini isimle coz — H2H gecmisi yine de cekilebilir.
  if (!hid) hid = await afTeamId(match.home_team);
  if (!aid) aid = await afTeamId(match.away_team);
  // 3) Sakatlar (fixture varsa)
  if (fx) {
    try {
      const inj = await afGet(`/injuries?fixture=${fx.fixture.id}`) || [];
      if (inj.length) {
        const home = inj.filter((x) => x.team.id === hid).map((x) => x.player.name);
        const away = inj.filter((x) => x.team.id === aid).map((x) => x.player.name);
        facts.injuries = `${home.join(', ') || 'yok'} — ${away.join(', ') || 'yok'}`;
      }
    } catch (_) {}
  }
  // 4) H2H son 5 (ID varsa). Ucretsiz planda "last" parametresi KAPALI; parametresiz
  //    cek, oynanmis maclari tarihe gore sirala, son 5'i al.
  if (hid && aid) {
    try {
      let h2h = await afGet(`/fixtures/headtohead?h2h=${hid}-${aid}`) || [];
      h2h = h2h
        .filter((f) => f && f.fixture && f.goals && f.goals.home != null && f.goals.away != null)
        .sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date))
        .slice(0, 5);
      facts.h2h = h2h.map((f) => ({
        res: `${f.teams.home.name} ${f.goals.home}-${f.goals.away} ${f.teams.away.name}`.replace(/ FC/g, ''),
        when: (f.fixture.date || '').slice(0, 7),
      }));
    } catch (_) {}
  }
  return facts;
}

// ---------- football-data.org (UCRETSIZ, GUNCEL SEZON: hakem + H2H + stadyum) ----------
const FD_BASE = 'https://api.football-data.org/v4';
async function fdGet(path) {
  const token = (process.env.FOOTBALL_DATA_TOKEN || '').trim();
  if (!token) return null;
  const res = await fetch(`${FD_BASE}${path}`, { headers: { 'X-Auth-Token': token } });
  if (!res.ok) throw new Error(`football-data ${res.status}`);
  return res.json();
}
// football-data turnuva kodunu kisa etikete cevirir.
function compShort(c) {
  const map = { PL: 'Lig', ELC: 'Ch', CL: 'ŞL', EL: 'AL', ECL: 'Konf', FA: 'FA', FAC: 'FA', EFL: 'LC', WC: 'DK', EC: 'EURO', CLI: 'ŞL' };
  return map[c] || String(c || '').slice(0, 3);
}
// Bir takimin SON 5 MACI (tum turnuvalar; ucretsiz planda kapsanan yaris/kupalar dahil).
async function fdTeamForm(teamId) {
  if (!teamId) return null;
  try {
    const j = await fdGet(`/teams/${teamId}/matches?status=FINISHED&limit=12`);
    const ms = (j && j.matches) || [];
    const last = ms
      .filter((x) => x.score && x.score.winner)
      .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))
      .slice(0, 5); // yeni -> eski (en yeni solda)
    if (!last.length) return null;
    return last.map((x) => {
      const isHome = x.homeTeam && x.homeTeam.id === teamId;
      let r = 'M';
      if (x.score.winner === 'DRAW') r = 'B';
      else if ((x.score.winner === 'HOME_TEAM' && isHome) || (x.score.winner === 'AWAY_TEAM' && !isHome)) r = 'G';
      const comp = compShort(x.competition && (x.competition.code || x.competition.name));
      return { r, comp };
    });
  } catch (_) { return null; }
}
async function fdFacts(match) {
  const out = { referee: null, stadium: null, h2h: [], formHome: null, formAway: null };
  if (!(process.env.FOOTBALL_DATA_TOKEN || '').trim()) return out;
  const hn = normName(match.home_team), an = normName(match.away_team);
  const day = new Date(match.commence_time);
  const from = new Date(day.getTime() - 2 * 86400000).toISOString().slice(0, 10);
  const to = new Date(day.getTime() + 2 * 86400000).toISOString().slice(0, 10);
  let list;
  try { list = await fdGet(`/competitions/PL/matches?dateFrom=${from}&dateTo=${to}`); } catch (_) { return out; }
  const matches = (list && list.matches) || [];
  const mt = matches.find((m) => normName(m.homeTeam && m.homeTeam.name) === hn && normName(m.awayTeam && m.awayTeam.name) === an)
    || matches.find((m) => normName((m.homeTeam && m.homeTeam.name) || '').includes(hn.slice(0, 5)) && normName((m.awayTeam && m.awayTeam.name) || '').includes(an.slice(0, 5)));
  if (!mt) return out;
  const refs = mt.referees || [];
  const ref = refs.find((r) => /^REFEREE$/i.test(r.type || '')) || refs.find((r) => /referee/i.test(r.type || '') && !/assistant|video|fourth/i.test(r.type || '')) || refs[0];
  out.referee = ref ? ref.name : null;
  out.stadium = mt.venue || null;
  const hid = mt.homeTeam && mt.homeTeam.id, aid = mt.awayTeam && mt.awayTeam.id;
  try {
    const h = await fdGet(`/matches/${mt.id}/head2head?limit=10`);
    const hm = (h && h.matches) || [];
    out.h2h = hm
      .filter((x) => x.score && x.score.fullTime && x.score.fullTime.home != null)
      .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))
      .slice(0, 5)
      .map((x) => ({ res: `${x.homeTeam.name} ${x.score.fullTime.home}-${x.score.fullTime.away} ${x.awayTeam.name}`.replace(/ FC/g, ''), when: (x.utcDate || '').slice(0, 7) }));
  } catch (_) {}
  // Son 5 mac (tum turnuvalar)
  out.formHome = await fdTeamForm(hid);
  out.formAway = await fdTeamForm(aid);
  return out;
}

// ---------- Understat (UCRETSIZ xG/xGA; sayfadaki JSON'dan cekilir) ----------
const UNDERSTAT_CACHE = {}; // { season: { at, data } } — coklu mac üretiminde tekrar cekmeyi onler
async function understatLeague(season) {
  const c = UNDERSTAT_CACHE[season];
  if (c && Date.now() - c.at < 30 * 60 * 1000) return c.data;
  const res = await fetch(`https://understat.com/league/EPL/${season}`, { headers: { 'user-agent': 'Mozilla/5.0', 'accept-language': 'en' } });
  if (!res.ok) throw new Error(`understat ${res.status}`);
  const html = await res.text();
  const m = html.match(/teamsData\s*=\s*JSON\.parse\('([^']+)'\)/);
  if (!m) return null;
  const decoded = m[1]
    .replace(/\\x([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  let data; try { data = JSON.parse(decoded); } catch (_) { return null; }
  const byName = {};
  for (const k in data) {
    const t = data[k]; const hist = t.history || []; const gp = hist.length;
    const xg = hist.reduce((s, h) => s + Number(h.xG || 0), 0);
    const xga = hist.reduce((s, h) => s + Number(h.xGA || 0), 0);
    byName[normName(t.title)] = { gp, xgPer: gp ? xg / gp : null, xgaPer: gp ? xga / gp : null, hist };
  }
  // Kadro (bu sezon oynayan oyuncular) — playersData'dan; takim -> en cok oynayan isimler.
  const rosters = {};
  const pm = html.match(/playersData\s*=\s*JSON\.parse\('([^']+)'\)/);
  if (pm) {
    const pdec = pm[1]
      .replace(/\\x([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\u([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    let players; try { players = JSON.parse(pdec); } catch (_) { players = null; }
    if (Array.isArray(players)) {
      const byTeam = {};
      for (const p of players) {
        const tt = normName(p.team_title || '');
        if (!tt || !p.player_name) continue;
        (byTeam[tt] = byTeam[tt] || []).push({ name: p.player_name, mins: Number(p.time || 0), pos: p.position || '' });
      }
      for (const tt in byTeam) {
        rosters[tt] = byTeam[tt].sort((a, b) => b.mins - a.mins).slice(0, 25);
      }
    }
  }
  const result = { stats: byName, rosters };
  UNDERSTAT_CACHE[season] = { at: Date.now(), data: result };
  return result;
}
// Understat pozisyon kodunu G/D/M/F'ye indirger.
function classifyPos(pos) {
  const p = String(pos || '').toUpperCase().replace(/\s+/g, ''); // "D M C" -> "DMC"
  if (/GK/.test(p)) return 'G';
  if (/^F|FW/.test(p)) return 'F';           // FW, FWL, FWR
  if (/AM|DM|^M/.test(p)) return 'M';        // AMC/AMR/DMC/MC vb. orta saha
  if (/^D/.test(p)) return 'D';              // DC, DR, DL
  return 'M';
}
// Bu sezon en cok oynayanlardan GUNCEL muhtemel 11 kurar (kaleci + 10 saha oyuncusu).
function buildXI(roster) {
  if (!Array.isArray(roster) || roster.length < 11) return null;
  const sorted = [...roster].sort((a, b) => b.mins - a.mins);
  const gk = sorted.find((x) => classifyPos(x.pos) === 'G');
  if (!gk) return null;
  const out = sorted.filter((x) => x !== gk).slice(0, 10);
  if (out.length < 10) return null;
  const D = [], M = [], F = [];
  for (const x of out) { const c = classifyPos(x.pos); (c === 'D' ? D : c === 'F' ? F : M).push(x.name); }
  const formation = `${D.length}-${M.length}-${F.length}`;
  return { formation, players: [gk.name, ...D, ...M, ...F] };
}
async function understatXG(match) {
  const hn = normName(match.home_team), an = normName(match.away_team);
  const cur = seasonOf(match.commence_time);
  const find = (tbl, n) => {
    if (!tbl) return null;
    if (tbl[n]) return tbl[n];
    const e = Object.entries(tbl).find(([k]) => k.includes(n.slice(0, 5)) || n.includes(k.slice(0, 5)));
    return e ? e[1] : null;
  };
  let cur1 = null; try { cur1 = await understatLeague(cur); } catch (_) {}
  const curTbl = cur1 && cur1.stats ? cur1.stats : null;
  const curRosters = cur1 && cur1.rosters ? cur1.rosters : null;
  let h = find(curTbl, hn), a = find(curTbl, an);
  let period = `${cur}-${String(cur + 1).slice(2)}`;
  const thin = (x) => !x || !x.gp || x.gp < 3;
  if (thin(h) || thin(a)) {
    let prev1 = null; try { prev1 = await understatLeague(cur - 1); } catch (_) {}
    const prevTbl = prev1 && prev1.stats ? prev1.stats : null;
    const ph = find(prevTbl, hn), pa = find(prevTbl, an);
    if (thin(h) && ph) h = ph;
    if (thin(a) && pa) a = pa;
    if (ph || pa) period = `${cur - 1}-${String(cur).slice(2)} baz`;
  }
  // Kadro (bu sezon oynayanlar; {name,mins,pos}) — GUNCEL muhtemel 11'i buradan kurariz.
  const rosterHomeObj = find(curRosters, hn) || null;
  const rosterAwayObj = find(curRosters, an) || null;
  const names = (r) => (Array.isArray(r) ? r.map((x) => x.name) : null);
  const rosterHome = names(rosterHomeObj);
  const rosterAway = names(rosterAwayObj);
  const xiHome = buildXI(rosterHomeObj);
  const xiAway = buildXI(rosterAwayObj);
  if (!h && !a) return { rosterHome, rosterAway, xiHome, xiAway };
  const f = (x) => (x && x.xgPer != null ? x.xgPer.toFixed(2) : 'veri yok');
  const fa = (x) => (x && x.xgaPer != null ? x.xgaPer.toFixed(2) : 'veri yok');
  // Son maclar (Understat yalnizca LIG maclarini tutar), en eski -> en yeni.
  const formOf = (x) => {
    if (!x || !x.hist) return null;
    const last = x.hist.filter((h) => h.result).sort((p, q) => new Date(q.date) - new Date(p.date)).slice(0, 5); // yeni -> eski
    if (!last.length) return null;
    return last.map((h) => ({ r: h.result === 'w' ? 'G' : h.result === 'd' ? 'B' : 'M', comp: 'Lig' }));
  };
  return {
    xg: `${f(h)} — ${f(a)} (${period})`,
    xga: `${fa(h)} — ${fa(a)} (${period})`,
    formHome: formOf(h),
    formAway: formOf(a),
    rosterHome, rosterAway, xiHome, xiAway,
  };
}

// ---------- Fantasy Premier League (RESMI, UCRETSIZ): guncel kadro + sakat/cezali ----------
// Tek istek tum takim ve oyuncularin GUNCEL durumunu verir (transfer/sakat dahil).
let FPL_CACHE = { at: 0, teams: null };
function clubKey(name) {
  // SADECE harf/rakama indir: boşluk, nokta, kesme, GÖRÜNMEZ karakter (zero-width vb.) hepsi gider.
  const raw = String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
  // Hem uygulamanın tam adları hem FPL'nin kısa adları AYNI anahtara eşlenir.
  const alias = {
    manchestercity: 'mancity', mancity: 'mancity',
    manchesterunited: 'manutd', manutd: 'manutd', manunited: 'manutd',
    tottenhamhotspur: 'spurs', tottenham: 'spurs', spurs: 'spurs',
    nottinghamforest: 'nottforest', nottmforest: 'nottforest', nottforest: 'nottforest',
    wolverhamptonwanderers: 'wolves', wolverhampton: 'wolves', wolves: 'wolves',
    newcastleunited: 'newcastle', newcastle: 'newcastle',
    westhamunited: 'westham', westham: 'westham',
    brightonandhovealbion: 'brighton', brightonhovealbion: 'brighton', brighton: 'brighton',
    afcbournemouth: 'bournemouth', bournemouth: 'bournemouth',
    leicestercity: 'leicester', leicester: 'leicester',
    ipswichtown: 'ipswich', ipswich: 'ipswich',
    leedsunited: 'leeds', leeds: 'leeds',
    coventrycity: 'coventry', coventry: 'coventry',
    hullcity: 'hull', hull: 'hull',
    sheffieldunited: 'sheffutd', sheffutd: 'sheffutd', sheffieldutd: 'sheffutd',
    sheffieldwednesday: 'sheffwed', sheffwed: 'sheffwed',
    westbromwichalbion: 'westbrom', westbrom: 'westbrom', westbromwich: 'westbrom',
  };
  return alias[raw] || raw;
}
async function fplData() {
  const now = Date.now();
  if (FPL_CACHE.teams && now - FPL_CACHE.at < 30 * 60 * 1000) return FPL_CACHE.teams;
  try {
    const res = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', { headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;
    const j = await res.json();
    const teamById = {};
    const out = {};
    for (const t of j.teams || []) { teamById[t.id] = t; out[clubKey(t.name)] = { name: t.name, short: t.short_name, players: [] }; }
    const posMap = { 1: 'G', 2: 'D', 3: 'M', 4: 'F' };
    for (const e of j.elements || []) {
      const t = teamById[e.team]; if (!t) continue;
      const pos = posMap[e.element_type]; if (!pos) continue; // menajer vb. atla
      const k = clubKey(t.name); if (!out[k]) continue;
      out[k].players.push({
        name: e.web_name, pos, mins: Number(e.minutes || 0), starts: Number(e.starts || 0),
        status: e.status || 'a', news: e.news || '',
      });
    }
    FPL_CACHE = { at: now, teams: out };
    return out;
  } catch (_) { return null; }
}
function fplFind(fpl, teamName) {
  if (!fpl) return null;
  const k = clubKey(teamName);
  if (fpl[k]) return fpl[k];
  const e = Object.entries(fpl).find(([kk]) => kk.includes(k.slice(0, 5)) || k.includes(kk.slice(0, 5)));
  return e ? e[1] : null;
}
// Guncel muhtemel 11 (sakat/cezali/ayrilan HARIC), en cok oynayanlardan.
function fplXI(team) {
  if (!team || !Array.isArray(team.players)) return null;
  const playable = team.players.filter((p) => p.status === 'a' || p.status === 'd');
  const gk = playable.filter((p) => p.pos === 'G').sort((a, b) => (b.starts - a.starts) || (b.mins - a.mins))[0];
  if (!gk) return null;
  const out = playable.filter((p) => p !== gk && p.pos !== 'G')
    .sort((a, b) => (b.mins - a.mins) || (b.starts - a.starts)).slice(0, 10);
  if (out.length < 10) return null;
  const D = [], M = [], F = [];
  for (const p of out) { (p.pos === 'D' ? D : p.pos === 'F' ? F : M).push(p.name); }
  return { formation: `${D.length}-${M.length}-${F.length}`, players: [gk.name, ...D, ...M, ...F] };
}
// Guncel eksik listesi (sakat/cezali/supheli) — resmi status'ten.
function fplInjuries(team) {
  if (!team || !Array.isArray(team.players)) return null;
  const lbl = (p) => {
    if (p.status === 's') return 'cezalı';
    if (p.status === 'i') return 'sakat';
    if (p.status === 'd') return 'şüpheli';
    return null;
  };
  const list = team.players
    .filter((p) => ['i', 's', 'd'].includes(p.status))
    .sort((a, b) => b.mins - a.mins).slice(0, 6)
    .map((p) => { const l = lbl(p); return l ? `${p.name} (${l})` : p.name; });
  return list.length ? list : null;
}

// ---------- COK KAYNAKLI birlestirici (tek siteye bagimli degil) ----------
function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}
async function gatherFacts(match) {
  const facts = { referee: null, stadium: null, injuries: null, h2h: [], h2h_note: null, xg: null, xga: null, formHome: null, formAway: null, rosterHome: null, rosterAway: null, xiHome: null, xiAway: null };
  const [fd, af, us, fpl] = await Promise.all([
    withTimeout(fdFacts(match), 12000).catch(() => null),      // football-data (guncel sezon)
    withTimeout(fetchFacts(match), 12000).catch(() => null),   // API-Football (yedek H2H/sakat)
    withTimeout(understatXG(match), 12000).catch(() => null),  // Understat (xG + form)
    withTimeout(fplData(), 12000).catch(() => null),           // FPL (guncel kadro + sakat)
  ]);
  // Oncelik: football-data (guncel, tum turnuvalar) > API-Football (gecmis)
  if (fd) {
    facts.referee = fd.referee || facts.referee;
    facts.stadium = fd.stadium || facts.stadium;
    if (fd.h2h && fd.h2h.length) facts.h2h = fd.h2h;
    if (fd.formHome && fd.formHome.length) facts.formHome = fd.formHome;
    if (fd.formAway && fd.formAway.length) facts.formAway = fd.formAway;
  }
  if (af) {
    facts.referee = facts.referee || af.referee;
    facts.stadium = facts.stadium || af.stadium;
    facts.injuries = facts.injuries || af.injuries;
    if (!facts.h2h.length && af.h2h && af.h2h.length) facts.h2h = af.h2h;
  }
  if (us) {
    facts.xg = us.xg; facts.xga = us.xga;
    // Understat yalnizca lig; football-data'dan form gelmediyse yedek olarak kullan.
    if (!facts.formHome && us.formHome) facts.formHome = us.formHome;
    if (!facts.formAway && us.formAway) facts.formAway = us.formAway;
    facts.rosterHome = us.rosterHome || null;
    facts.rosterAway = us.rosterAway || null;
  }
  // FPL (RESMI, GUNCEL): muhtemel 11 ve eksik listesi buradan — transferli/eski oyuncu giremez.
  if (fpl) {
    const fh = fplFind(fpl, match.home_team), fa = fplFind(fpl, match.away_team);
    const xh = fplXI(fh), xa = fplXI(fa);
    if (xh) facts.xiHome = xh;
    if (xa) facts.xiAway = xa;
    const injH = fplInjuries(fh), injA = fplInjuries(fa);
    if (injH || injA) facts.injuries = `${injH ? injH.join(', ') : 'yok'} — ${injA ? injA.join(', ') : 'yok'}`;
    // Kendini teshis: FPL yuklendi mi, ev/dep eslesti mi, kac oyuncu, 11 kuruldu mu.
    facts.fplDbg = {
      loaded: true, teams: Object.keys(fpl).length,
      hk: clubKey(match.home_team), ak: clubKey(match.away_team),
      home: fh ? `${fh.name}(${fh.players.length}p,xi:${xh ? 'ok' : 'yok'})` : 'ESLESMEDI',
      away: fa ? `${fa.name}(${fa.players.length}p,xi:${xa ? 'ok' : 'yok'})` : 'ESLESMEDI',
    };
  } else {
    facts.fplDbg = { loaded: false };
  }
  return facts;
}

// ---------- Tani (admin debug): API-Football gercekte ne donuyor? ----------
async function apiFootballDiag(match) {
  const key = (process.env.APIFOOTBALL_KEY || '').trim();
  const out = { keyPresent: !!key, keyLen: key.length };
  if (!key) { out.error = 'APIFOOTBALL_KEY tanimli degil.'; return out; }
  const call = async (path) => {
    try {
      const res = await fetch(`${AF_BASE}${path}`, { headers: { 'x-apisports-key': key } });
      const j = await res.json().catch(() => ({}));
      return { status: res.status, results: j.results, errors: j.errors, response: j.response };
    } catch (e) { return { error: String(e.message || e) }; }
  };
  // Hesap/plan durumu
  const st = await call('/status');
  out.status = st.status;
  out.account = st.response && st.response.subscription ? {
    plan: st.response.subscription.plan,
    active: st.response.subscription.active,
    requests: st.response.requests,
  } : (st.errors || st.response || null);
  if (match) {
    const date = new Date(match.commence_time).toISOString().slice(0, 10);
    const season = seasonOf(match.commence_time);
    out.match = `${match.home_team} - ${match.away_team}`;
    out.date = date; out.season = season;
    const fx = await call(`/fixtures?date=${date}&league=${AF_LEAGUE}&season=${season}`);
    out.fixturesStatus = fx.status;
    out.fixturesCount = fx.results;
    out.fixturesErrors = fx.errors;
    out.sampleFixtures = Array.isArray(fx.response) ? fx.response.slice(0, 4).map((f) => `${f.teams.home.name}-${f.teams.away.name}`) : null;
    const hid = await afTeamId(match.home_team);
    const aid = await afTeamId(match.away_team);
    out.teamIds = { home: hid, away: aid };
    if (hid && aid) {
      const h = await call(`/fixtures/headtohead?h2h=${hid}-${aid}`);
      out.h2hStatus = h.status; out.h2hCount = h.results; out.h2hErrors = h.errors;
    }
    // Diger kaynaklar (cok kaynakli):
    out.footballDataToken = !!(process.env.FOOTBALL_DATA_TOKEN || '').trim();
    try { const fd = await fdFacts(match); out.footballData = { referee: fd.referee, stadium: fd.stadium, h2hCount: fd.h2h.length, formHome: fd.formHome, formAway: fd.formAway }; }
    catch (e) { out.footballData = { error: String(e.message || e) }; }
    try { const us = await understatXG(match); out.understat = us || 'bulunamadi'; }
    catch (e) { out.understat = { error: String(e.message || e) }; }
    // FPL: takimlar eslesti mi, guncel 11 kurulabildi mi?
    try {
      const fpl = await fplData();
      if (!fpl) { out.fpl = { error: 'FPL erisilemedi/bos' }; }
      else {
        const fh = fplFind(fpl, match.home_team), fa = fplFind(fpl, match.away_team);
        const xh = fplXI(fh), xa = fplXI(fa);
        out.fpl = {
          teamsLoaded: Object.keys(fpl).length,
          home: { matched: !!fh, name: fh && fh.name, players: fh ? fh.players.length : 0, xi: xh ? xh.players : null },
          away: { matched: !!fa, name: fa && fa.name, players: fa ? fa.players.length : 0, xi: xa ? xa.players : null },
        };
      }
    } catch (e) { out.fpl = { error: String(e.message || e) }; }
  }
  return out;
}

// ---------- Gemini (ucretsiz AI) ----------
function extractJson(text) {
  const i = text.indexOf('{'); const j = text.lastIndexOf('}');
  if (i < 0 || j < 0 || j <= i) return null;
  try { return JSON.parse(text.slice(i, j + 1)); } catch (_) { return null; }
}
// Hesabin gercekten destekledigi modelleri Google'dan sor (ad tahmini yok).
// Hem v1beta hem v1 ListModels denenir; hangi API surumu calisiyorsa o kullanilir.
async function listModels(key, ver) {
  const url = `https://generativelanguage.googleapis.com/${ver}/models?key=${key}&pageSize=100`;
  const res = await fetch(url);
  const txt = await res.text().catch(() => '');
  if (!res.ok) return { ver, ok: false, status: res.status, err: txt.slice(0, 200), names: [] };
  let j; try { j = JSON.parse(txt); } catch (_) { return { ver, ok: false, status: res.status, err: 'JSON parse', names: [] }; }
  const names = (j.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => (m.name || '').replace(/^models\//, ''))
    .filter(Boolean);
  return { ver, ok: true, status: res.status, names };
}
// Aday modelleri tercih sirasina diz (en iyi ilk): once GEMINI_MODEL, sonra flash, sonra pro.
function orderModels(names) {
  const bad = /(vision|thinking|image|tts|audio|embedding|learnlm|aqa|gemma)/i;
  const env = (process.env.GEMINI_MODEL || '').trim();
  const score = (n) => {
    let s = 0;
    if (env && n === env) s += 1000;
    if (/flash/i.test(n)) s += 100;
    if (/pro/i.test(n)) s += 50;
    if (/2\.5/.test(n)) s += 20; else if (/2\.0/.test(n)) s += 15; else if (/1\.5/.test(n)) s += 5;
    if (/latest/i.test(n)) s += 3;
    if (/preview|exp|-\d{2,}/i.test(n)) s -= 5; // kararsiz surumleri geri planda
    if (bad.test(n)) s -= 500;
    return s;
  };
  return [...names].sort((a, b) => score(b) - score(a));
}

async function genContent(key, ver, model, prompt, useSearch) {
  const url = `https://generativelanguage.googleapis.com/${ver}/models/${model}:generateContent?key=${key}`;
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 1800 } };
  if (useSearch) body.tools = [{ google_search: {} }];
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const txt = await res.text().catch(() => '');
  return { status: res.status, ok: res.ok, txt };
}

// GERCEKTEN calisan {ver, model} ciftini bul: ListModels'a guvenme, kucuk bir
// deneme cagrisi (araci olmadan) ile 200 donen ilk modeli sec.
async function resolveModel(key) {
  const diag = [];
  for (const ver of ['v1beta', 'v1']) {
    const r = await listModels(key, ver);
    if (!r.ok) { diag.push(`${ver} ListModels ${r.status}: ${r.err.slice(0, 80)}`); continue; }
    if (!r.names.length) { diag.push(`${ver}: generateContent destekleyen model yok`); continue; }
    const ordered = orderModels(r.names);
    let tested = 0;
    for (const model of ordered) {
      if (tested >= 5) break; // kotayi bosa harcama; en iyi 5 adayi dene
      tested++;
      const t = await genContent(key, ver, model, 'ping', false);
      if (t.ok) return { ver, model, diag };
      diag.push(`${ver}/${model} test ${t.status}: ${t.txt.slice(0, 60)}`);
    }
  }
  return { ver: null, model: null, diag };
}

async function callGemini(prompt) {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new Error('GEMINI_API_KEY tanimli degil.');

  let ver, model, diag = [];
  if (RESOLVED_MODEL) { ({ ver, model } = RESOLVED_MODEL); }
  else {
    const r = await resolveModel(key);
    ver = r.ver; model = r.model; diag = r.diag;
    if (!model) {
      throw new Error(`Calisan Gemini modeli bulunamadi. Anahtar gecerli mi ve Google Cloud'da "Generative Language API" acik mi? Denemeler: ${diag.slice(0, 6).join(' | ') || 'ListModels bos'}`);
    }
  }

  // Once aramali dene; HERHANGI bir hatada aramasiza dus (arama araci bazi
  // modellerde/surumlerde beklenmedik hata verebiliyor).
  // 503/429/asiri yuk gibi GECICI hatalarda kisa beklemeyle 3'e kadar yeniden dene.
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const isTransient = (r) => r.status === 503 || r.status === 429 || r.status === 500
    || /overload|high load|unavailable|try again|rate limit|temporar/i.test(r.txt || '');
  let lastErr = '';
  for (const useSearch of (GEMINI_SEARCH ? [true, false] : [false])) {
    let r;
    for (let attempt = 0; attempt < 3; attempt++) {
      r = await genContent(key, ver, model, prompt, useSearch);
      if (r.ok || !isTransient(r)) break;
      await sleep(1500 * (attempt + 1)); // 1.5s -> 3s bekle, sonra tekrar dene
    }
    if (r.ok) {
      let data; try { data = JSON.parse(r.txt); } catch (_) { data = {}; }
      const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
      const rep = extractJson(parts.map((p) => p.text || '').join('\n'));
      if (!rep) { lastErr = 'Gemini yaniti JSON olarak cozulemedi'; continue; }
      RESOLVED_MODEL = { ver, model }; // calisan cifti hatirla
      return rep;
    }
    lastErr = `(${ver}/${model}${useSearch ? '+arama' : ''}) ${r.status}: ${r.txt.slice(0, 160)}`;
  }
  const hint = diag.length ? ` [test: ${diag.slice(0, 4).join(' | ')}]` : '';
  throw new Error(`Gemini API hatasi: ${lastErr}${hint}`);
}

function buildPrompt(match, nums, facts) {
  const dateStr = new Date(match.commence_time).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' });
  const todayStr = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' });
  const season = seasonOf(match.commence_time);
  const seasonStr = `${season}-${String(season + 1).slice(2)}`;
  const prevStr = `${season - 1}-${String(season).slice(2)}`;
  const h2hStr = facts.h2h.length ? facts.h2h.map((x) => `${x.res} (${x.when})`).join('; ') : 'bilinmiyor';
  return `Sen deneyimli bir futbol veri analistisin. ${match.home_team} - ${match.away_team} (Premier Lig, ${dateStr}) için Türkçe "Saha Raporu" hazırla. Bugün: ${todayStr}.

SİTENİN KENDİ ORANLARI (bunları AYNEN kullan, DEĞİŞTİRME; analizi ve sonucu bunlara dayandır):
- Bahis Oranı (1-X-2): ${nums.oddsLine || 'yok'}
- En olası skorlar: ${nums.scores.join(' · ') || 'yok'}
- 2.5 ÜST ihtimali: ${nums.ou ? '%' + Math.round(nums.ou.over) : 'yok'}
- KG VAR ihtimali: ${nums.kg ? '%' + Math.round(nums.kg.yes) : 'yok'}
HAZIR GERÇEKLER (kaynaklardan çekildi — DEĞİŞTİRME, olduğu gibi kullan):
- Hakem: ${facts.referee || 'yok'}
- Stadyum: ${facts.stadium || 'yok'}
- Eksikler (ev — dep): ${facts.injuries || 'yok'}
- Son maçlar (H2H): ${h2hStr}
- xG maç başı (Understat): ${facts.xg || 'yok'}
- xGA maç başı (Understat): ${facts.xga || 'yok'}
- Son 5 maç formu (G/B/M, yeni→eski) ev: ${(facts.formHome && facts.formHome.map((x) => x.r).join(' ')) || 'yok'} | dep: ${(facts.formAway && facts.formAway.map((x) => x.r).join(' ')) || 'yok'}

ÖNEMLİ: Yukarıdaki "HAZIR GERÇEKLER"de dolu olan alanları (hakem, xG, xGA, H2H, eksik) AYNEN kullan, tekrar arama. SADECE "yok" olan alanları GOOGLE ARAMASI ile GERÇEK kaynaklardan tamamla. ÖNCELİKLE sofascore.com'a bak (bu maçın ve iki takımın SofaScore sayfaları; sakat/eksik oyuncu, hakem, pres/PPDA için en iyi kaynak). SofaScore'da bulamazsan sırayla fbref.com, understat, whoscored, transfermarkt, premierleague.com kaynaklarına bak. Aramaları "SofaScore ${match.home_team} ${match.away_team}", "SofaScore ${match.home_team} sakatlıklar", "${match.home_team} ${match.away_team} hakem" gibi yap. Her satırı ELİNDEN GELDİĞİNCE DOLDUR:
1) xG (maç başı): önce ${seasonStr} sezonu; sezon başıysa/az maç oynanmışsa ${prevStr} sezon ortalamasını kullan ve parantezle belirt. Örn: "1.75 — 1.60 (${prevStr})".
2) xGA (maç başı): aynı kural.
3) Eksik/sakat/cezalı oyuncular: iki takım için GÜNCEL (bu maç haftasına ait) listeyi ara ve isim ver. SADECE şu an o takımda olan oyuncuları yaz; başka takıma transfer olmuş/ayrılmış oyuncuyu ASLA yazma. Eski sezon bilgine güvenme, güncel sakatlık haberinden doğrula. Emin olamadığın oyuncuyu ekleme; hiçbir güncel sakat bulamazsan "veri yok" yaz.
4) Son 5 karşılaşma (H2H): yoksa aramayla bul, skorlarıyla özetle.
5) Hakem: bu maça atanan hakem açıklandıysa yaz.
6) PPDA veya pres yoğunluğu (baskı): ${seasonStr} yoksa ${prevStr} değerini kullan, kaynağı ima et.
7) Güncel form ve lig sırası bilgisini "intro" ve "why" içinde kullan.
(Not: Muhtemel 11 ve eksik oyuncu listesi AYRI bir resmi kaynaktan alınıyor; sen kadro/11 YAZMA.)

KURALLAR: Sadece gerçekten aradıktan sonra hiçbir şey bulamazsan o değeri "veri yok" yaz (kadroda boş dizi). Tahmini bir aralık, geçen sezon ortalaması gibi GERÇEK bir veri her zaman "veri yok"dan iyidir. Ama ASLA uydurma/rastgele sayı ya da oyuncu adı verme; verdiğin her şey aranan gerçek bir kaynaktan olmalı. Oyuncu adlarında güncel kadroya sadık kal — transfer olup ayrılmış oyuncuyu eski takımına YAZMA.

SADECE şu JSON'u döndür (başka metin, markdown, açıklama YOK):
{"meta":{"league":"Premier Lig","week":null,"date":"${dateStr}","stadium":${JSON.stringify(facts.stadium)}},
"intro":"2-3 cümle, güncel form/sıralamaya değin",
"data":[["Bahis Oranı (1-X-2)","${nums.oddsLine || 'veri yok'}"],["xG (Maç Başı)",${JSON.stringify(facts.xg || '<ev> — <dep> (dönem)')}],["xGA (Maç Başı)",${JSON.stringify(facts.xga || '<ev> — <dep> (dönem)')}],["En Olası Skorlar","${nums.scores.join(' · ') || 'veri yok'}"],["Eksik Oyuncu",${JSON.stringify(facts.injuries || '<ev eksikleri> — <dep eksikleri>')}],["Son 5 H2H","<kısa özet>"]],
"gauges":[],
"conclusion":{"title":"kısa sonuç (ör. Ev Sahibi Favori)","note":"1 cümle, oranlara dayalı"},
"h2h":${JSON.stringify(facts.h2h)},
"h2h_note":"1 cümle | null",
"extras":[["Hakem",${JSON.stringify(facts.referee || '<hakem>')}],["Baskı (PPDA)","<ev> — <dep> (dönem)"]],
"why":"2-3 cümle, oranlar + xG + form birlikte",
"footer":"Bu rapor istatistiksel analiz içerir; kesin sonuç garantisi vermez."}`;
}

// Bir deger "bos/veri yok" mu? (satiri tamamen gizlemek icin)
function isEmptyVal(v) {
  if (v == null) return true;
  const s = String(v).trim();
  if (!s) return true;
  if (/^(veri yok|bilinmiyor|yok|null|undefined|-|—|–|n\/a)$/i.test(s)) return true;
  // "Aston Villa — Arsenal | veri yok" gibi: rakam icermiyorsa ve "veri yok" geciyorsa bos say
  if (/veri yok|bilinmiyor/i.test(s) && !/\d/.test(s)) return true;
  return false;
}
function stripEmpty(rows) {
  return (rows || []).filter((r) => Array.isArray(r) && !isEmptyVal(r[1]));
}

async function generateReportFor(match) {
  const nums = deriveNumbers(match.markets);
  const facts = await gatherFacts(match);
  const report = await callGemini(buildPrompt(match, nums, facts));
  // Kesin sayisal alanlari garanti et.
  const g = [];
  if (nums.ou) g.push({ label: '2.5 ÜST İHTİMALİ', pct: Math.round(nums.ou.over) });
  if (nums.kg) g.push({ label: 'KG VAR İHTİMALİ', pct: Math.round(nums.kg.yes) });
  report.gauges = g;
  if (facts.h2h.length) report.h2h = facts.h2h;
  // Son 5 lig maci formu (Understat'tan; deterministik olarak eklenir).
  if (facts.formHome || facts.formAway) {
    report.form = { homeTeam: match.home_team, awayTeam: match.away_team, home: facts.formHome || [], away: facts.formAway || [] };
  }
  // Muhtemel 11: YALNIZCA FPL'den (resmi, guncel kadro). Gemini'nin kadro yazma yolu
  // KALDIRILDI — bir daha eski/yanlis isim gosterilmesin. FPL veremezse o takim "veri yok".
  const homeXi = (facts.xiHome && facts.xiHome.players) ? facts.xiHome.players : [];
  const awayXi = (facts.xiAway && facts.xiAway.players) ? facts.xiAway.players : [];
  if (homeXi.length || awayXi.length) {
    report.lineups = {
      homeTeam: match.home_team, awayTeam: match.away_team,
      homeFormation: (facts.xiHome && facts.xiHome.formation) || null,
      awayFormation: (facts.xiAway && facts.xiAway.formation) || null,
      home: homeXi, away: awayXi,
      homeSrc: facts.xiHome ? 'fpl' : 'none',
      awaySrc: facts.xiAway ? 'fpl' : 'none',
      src: 'fpl',
    };
  } else { delete report.lineups; }
  // Surum damgasi + FPL kendini teshis (eski rapor karisikligini ve eslesme sorununu gosterir).
  report.gen = { by: 'fpl-xi-v3', at: new Date().toISOString(), fpl: facts.fplDbg || null };
  // Bos ("veri yok") satirlari hic gosterme.
  report.data = stripEmpty(report.data);
  report.extras = stripEmpty(report.extras);
  if (report.h2h_note && isEmptyVal(report.h2h_note)) report.h2h_note = null;
  await sql`UPDATE matches SET report=${JSON.stringify(report)}::jsonb, report_at=now() WHERE id=${match.id}`;
  return report;
}

async function generatePending(opts = {}) {
  // Rapor MAC GUNU uretilir: bugun (TR) baslayan ve henuz baslamamis maclar.
  // REPORT_DAYS ile pencere buyutulebilir (varsayilan 1 = sadece bugun).
  const days = Math.max(1, Number(process.env.REPORT_DAYS || opts.days || 1));
  const budgetMs = Number(opts.budgetMs || 45000);
  if (!(process.env.GEMINI_API_KEY || '').trim()) return { ok: false, error: 'GEMINI_API_KEY yok' };
  const claim = await sql`UPDATE app_state SET report_lock=now()
    WHERE id=1 AND (report_lock IS NULL OR report_lock < now() - interval '3 minutes') RETURNING id`;
  if (!claim.length) return { ok: true, skipped: 'locked', generated: 0 };
  const started = Date.now();
  let generated = 0; const errors = [];
  try {
    // TR takvimine gore bugunun sonu (yarin 00:00 TR). days>1 ise ileri gunler de dahil.
    const rows = await sql`SELECT id, home_team, away_team, commence_time, markets
      FROM matches WHERE status='open' AND report IS NULL
        AND commence_time > now()
        AND commence_time < ((date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') + (${days} * interval '1 day')) AT TIME ZONE 'Europe/Istanbul')
      ORDER BY commence_time ASC`;
    for (const m of rows) {
      if (Date.now() - started > budgetMs) break;
      try { await generateReportFor(m); generated++; }
      catch (e) { errors.push(`${m.home_team}-${m.away_team}: ${String(e.message || e).slice(0, 140)}`); }
    }
  } finally {
    await sql`UPDATE app_state SET report_lock=NULL WHERE id=1`;
  }
  return { ok: true, generated, errors };
}

// TEK TUS: tum yaklasan maclarin raporunu YENIDEN uretir (mevcut olani da gunceller).
// Butce dolarsa kaldigi yerden ilerlemek icin son 10 dk icinde yenilenmis olanlari atlar;
// tekrar basildikca kalanlar tamamlanir.
async function regenerateReports(opts = {}) {
  const budgetMs = Number(opts.budgetMs || 55000);
  if (!(process.env.GEMINI_API_KEY || '').trim()) return { ok: false, error: 'GEMINI_API_KEY yok' };
  const claim = await sql`UPDATE app_state SET report_lock=now()
    WHERE id=1 AND (report_lock IS NULL OR report_lock < now() - interval '3 minutes') RETURNING id`;
  if (!claim.length) return { ok: true, skipped: 'locked', generated: 0, remaining: null };
  const started = Date.now();
  let generated = 0; const errors = []; let remaining = 0; let total = 0;
  try {
    const rows = await sql`SELECT id, home_team, away_team, commence_time, markets
      FROM matches
      WHERE status='open' AND commence_time > now()
        AND (report_at IS NULL OR report_at < now() - interval '10 minutes')
      ORDER BY commence_time ASC`;
    total = rows.length;
    for (const m of rows) {
      if (Date.now() - started > budgetMs) { remaining = total - generated - errors.length; break; }
      try { await generateReportFor(m); generated++; }
      catch (e) { errors.push(`${m.home_team}-${m.away_team}: ${String(e.message || e).slice(0, 140)}`); }
    }
  } finally {
    await sql`UPDATE app_state SET report_lock=NULL WHERE id=1`;
  }
  return { ok: true, generated, remaining, total, errors };
}

module.exports = { generatePending, generateReportFor, apiFootballDiag, regenerateReports };
