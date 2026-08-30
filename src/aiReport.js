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
async function fetchFacts(match) {
  const facts = { referee: null, stadium: null, injuries: null, h2h: [], h2h_note: null };
  if (!(process.env.APIFOOTBALL_KEY || '').trim()) return facts;
  try {
    const date = new Date(match.commence_time).toISOString().slice(0, 10);
    const season = seasonOf(match.commence_time);
    const fixtures = await afGet(`/fixtures?date=${date}&league=${AF_LEAGUE}&season=${season}`) || [];
    const hn = normName(match.home_team), an = normName(match.away_team);
    const fx = fixtures.find((f) => normName(f.teams.home.name) === hn && normName(f.teams.away.name) === an)
      || fixtures.find((f) => normName(f.teams.home.name).includes(hn.slice(0, 5)) && normName(f.teams.away.name).includes(an.slice(0, 5)));
    if (!fx) return facts;
    facts.referee = fx.fixture.referee || null;
    facts.stadium = (fx.fixture.venue && fx.fixture.venue.name) || null;
    const hid = fx.teams.home.id, aid = fx.teams.away.id;
    // Sakatlar
    try {
      const inj = await afGet(`/injuries?fixture=${fx.fixture.id}`) || [];
      if (inj.length) {
        const home = inj.filter((x) => x.team.id === hid).map((x) => x.player.name);
        const away = inj.filter((x) => x.team.id === aid).map((x) => x.player.name);
        facts.injuries = `${home.join(', ') || 'yok'} — ${away.join(', ') || 'yok'}`;
      }
    } catch (_) {}
    // H2H son 5
    try {
      const h2h = await afGet(`/fixtures/headtohead?h2h=${hid}-${aid}&last=5`) || [];
      facts.h2h = h2h.map((f) => ({
        res: `${f.teams.home.name} ${f.goals.home}-${f.goals.away} ${f.teams.away.name}`.replace(/ FC/g, ''),
        when: (f.fixture.date || '').slice(0, 7),
      }));
    } catch (_) {}
  } catch (_) {}
  return facts;
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
  const h2hStr = facts.h2h.length ? facts.h2h.map((x) => `${x.res} (${x.when})`).join('; ') : 'bilinmiyor';
  return `Sen bir futbol veri analistisin. ${match.home_team} - ${match.away_team} (Premier Lig, ${dateStr}) için Türkçe "Saha Raporu" hazırla.

VERİLEN GERÇEKLER (bunları KULLAN, DEĞİŞTİRME):
- Bahis Oranı (1-X-2): ${nums.oddsLine || 'yok'}
- En olası skorlar: ${nums.scores.join(' · ') || 'yok'}
- 2.5 ÜST ihtimali: ${nums.ou ? '%' + Math.round(nums.ou.over) : 'yok'}
- KG VAR ihtimali: ${nums.kg ? '%' + Math.round(nums.kg.yes) : 'yok'}
- Hakem: ${facts.referee || 'bilinmiyor'}
- Stadyum: ${facts.stadium || 'bilinmiyor'}
- Eksik oyuncular (ev — deplasman): ${facts.injuries || 'bilinmiyor'}
- Son karşılaşmalar: ${h2hStr}

GOOGLE ARAMASI ile şunları güncel doğrula/bul: iki takımın bu sezon (2026-27) maç başına xG ve xGA'sı; eksik oyuncular eksikse tamamla; güncel form ve lig sırası. Bulamadığını "veri yok" yaz, ASLA uydurma.

SADECE şu JSON'u döndür (başka metin yok):
{"meta":{"league":"Premier Lig","week":null,"date":"${dateStr}","stadium":${JSON.stringify(facts.stadium)}},
"intro":"2-3 cümle",
"data":[["Bahis Oranı (1-X-2)","${nums.oddsLine || 'veri yok'}"],["xG (Sezon, Maç Başı)","<ev> — <dep> | veri yok"],["xGA (Sezon, Maç Başı)","<ev> — <dep> | veri yok"],["En Olası Skorlar","${nums.scores.join(' · ') || 'veri yok'}"],["Eksik Oyuncu",${JSON.stringify(facts.injuries || 'veri yok')}],["Son 5 H2H","<özet> | veri yok"]],
"gauges":[],
"conclusion":{"title":"kısa sonuç","note":"1 cümle"},
"h2h":${JSON.stringify(facts.h2h)},
"h2h_note":"1 cümle | null",
"extras":[["Hakem",${JSON.stringify(facts.referee || 'veri yok')}],["Baskı (PPDA)","veri yok"]],
"why":"2-3 cümle",
"footer":"Bu rapor istatistiksel analiz içerir; kesin sonuç garantisi vermez."}`;
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
  await sql`UPDATE matches SET report=${JSON.stringify(report)}::jsonb, report_at=now() WHERE id=${match.id}`;
  return report;
}

async function generatePending(opts = {}) {
  const days = Number(process.env.REPORT_DAYS || opts.days || 2);
  const budgetMs = Number(opts.budgetMs || 45000);
  if (!(process.env.GEMINI_API_KEY || '').trim()) return { ok: false, error: 'GEMINI_API_KEY yok' };
  const claim = await sql`UPDATE app_state SET report_lock=now()
    WHERE id=1 AND (report_lock IS NULL OR report_lock < now() - interval '3 minutes') RETURNING id`;
  if (!claim.length) return { ok: true, skipped: 'locked', generated: 0 };
  const started = Date.now();
  let generated = 0; const errors = [];
  try {
    const rows = await sql`SELECT id, home_team, away_team, commence_time, markets
      FROM matches WHERE status='open' AND report IS NULL
        AND commence_time > now() AND commence_time < now() + (${days} * interval '1 day')
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

module.exports = { generatePending, generateReportFor };
