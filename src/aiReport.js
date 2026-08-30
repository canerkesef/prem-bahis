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
  let lastErr = '';
  for (const useSearch of (GEMINI_SEARCH ? [true, false] : [false])) {
    const r = await genContent(key, ver, model, prompt, useSearch);
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
Hazir gerçekler (varsa kullan): Hakem: ${facts.referee || 'yok'} | Stadyum: ${facts.stadium || 'yok'} | Eksikler (ev — dep): ${facts.injuries || 'yok'} | Son maçlar: ${h2hStr}

GÖREV — GOOGLE ARAMASI YAP ve şu verileri GERÇEK kaynaklardan bul. ÖNCELİKLE sofascore.com'a bak (bu maçın ve iki takımın SofaScore sayfaları; istatistik, sakat/eksik oyuncu, hakem ve H2H için en iyi kaynak). SofaScore'da bulamazsan sırayla fbref.com, understat, whoscored, transfermarkt, premierleague.com kaynaklarına bak. İlgili aramaları "SofaScore ${match.home_team} ${match.away_team}", "SofaScore ${match.home_team} istatistik", "SofaScore ${match.away_team} sakatlıklar/hakem" gibi yap. Her satırı ELİNDEN GELDİĞİNCE DOLDUR:
1) xG (maç başı): önce ${seasonStr} sezonu; sezon başıysa/az maç oynanmışsa ${prevStr} sezon ortalamasını kullan ve parantezle belirt. Örn: "1.75 — 1.60 (${prevStr})".
2) xGA (maç başı): aynı kural.
3) Eksik/sakat/cezalı oyuncular: iki takım için güncel listeyi ara ve isim ver.
4) Son 5 karşılaşma (H2H): yoksa aramayla bul, skorlarıyla özetle.
5) Hakem: bu maça atanan hakem açıklandıysa yaz.
6) PPDA veya pres yoğunluğu (baskı): ${seasonStr} yoksa ${prevStr} değerini kullan, kaynağı ima et.
7) Güncel form ve lig sırası bilgisini "intro" ve "why" içinde kullan.

KURALLAR: Sadece gerçekten aradıktan sonra hiçbir şey bulamazsan o değeri "veri yok" yaz. Tahmini bir aralık, geçen sezon ortalaması gibi GERÇEK bir veri her zaman "veri yok"dan iyidir. Ama ASLA uydurma/rastgele sayı verme; verdiğin sayı aranan gerçek bir kaynaktan olmalı.

SADECE şu JSON'u döndür (başka metin, markdown, açıklama YOK):
{"meta":{"league":"Premier Lig","week":null,"date":"${dateStr}","stadium":${JSON.stringify(facts.stadium)}},
"intro":"2-3 cümle, güncel form/sıralamaya değin",
"data":[["Bahis Oranı (1-X-2)","${nums.oddsLine || 'veri yok'}"],["xG (Maç Başı)","<ev> — <dep> (dönem)"],["xGA (Maç Başı)","<ev> — <dep> (dönem)"],["En Olası Skorlar","${nums.scores.join(' · ') || 'veri yok'}"],["Eksik Oyuncu",${JSON.stringify(facts.injuries || '<ev eksikleri> — <dep eksikleri>')}],["Son 5 H2H","<kısa özet>"]],
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
  const facts = await fetchFacts(match);
  const report = await callGemini(buildPrompt(match, nums, facts));
  // Kesin sayisal alanlari garanti et.
  const g = [];
  if (nums.ou) g.push({ label: '2.5 ÜST İHTİMALİ', pct: Math.round(nums.ou.over) });
  if (nums.kg) g.push({ label: 'KG VAR İHTİMALİ', pct: Math.round(nums.kg.yes) });
  report.gauges = g;
  if (facts.h2h.length) report.h2h = facts.h2h;
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

module.exports = { generatePending, generateReportFor, apiFootballDiag };
