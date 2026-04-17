// ============================================================
//  course-selector.js  –  Banevalg + HCP-beregning til FGL App
//  Sheet-struktur: KlubNavn | Bane | TeeSted | CR | Slope | Par
//                  | H1Par | H1SI | H2Par | H2SI | ... | H18Par | H18SI
// ============================================================

const FGL_COURSE_KEY = 'fgl_course_v1';
const CS_SHEET_ID    = '1f8Y3z7YaEQlemWVe61pIjy7kUkBKeYu71ys7887DnEQ';
const CS_SHEET_NAME  = 'Baner';
const CS_CACHE_KEY   = 'fgl_courses_cache_v1';

let _sheetData        = null;  // råt grupperingsdata { klubNavn -> { banNavn -> [tees] } }
let _csSelectedKlub   = null;
let _csSelectedBane   = null;
let _csSelectedTeeIdx = null;
let _csSearchTimeout  = null;
let _csKlubResults    = [];

// ── Sheet-parsing ────────────────────────────────────────────
// Ny struktur: A=KlubNavn, B=Bane, C=TeeSted, D=CR, E=Slope, F=Par
//              G=H1Par, H=H1SI, I=H2Par, J=H2SI ... (par+SI skiftevis)

function csParseSheetRow(row) {
  const klubNavn = (row[0] || '').toString().trim();
  const bane     = (row[1] || '').toString().trim();
  const teeSted  = (row[2] || '').toString().trim();
  const cr       = parseFloat(row[3]) || null;
  const slope    = parseInt(row[4])   || null;
  const par      = parseInt(row[5])   || null;
  const holes    = [];
  for (let i = 0; i < 18; i++) {
    const parVal = parseInt(row[6 + i * 2]);
    const siVal  = parseInt(row[7 + i * 2]);
    holes.push({
      n:   i + 1,
      par: isNaN(parVal) ? null : parVal,
      si:  isNaN(siVal)  ? null : siVal
    });
  }
  return { klubNavn, bane, teeSted, cr, slope, par, holes };
}

// Returnerer nested struktur: { 'KlubNavn': { 'BaneNavn': [ {tee}, ... ] } }
function csGroupData(rows) {
  const data = {};
  rows.forEach((row, idx) => {
    const { klubNavn, bane, teeSted, cr, slope, par, holes } = csParseSheetRow(row);
    if (!klubNavn) return;
    const baneKey = bane || '18 huls bane';
    const teeKey  = teeSted || `Tee ${idx + 1}`;

    if (!data[klubNavn]) data[klubNavn] = {};
    if (!data[klubNavn][baneKey]) data[klubNavn][baneKey] = [];
    data[klubNavn][baneKey].push({
      tee_name:      teeKey,
      course_rating: cr,
      slope_rating:  slope,
      par:           par,
      holes
    });
  });
  return data;
}

async function csFetchCoursesFromSheet() {
  const url  = `https://docs.google.com/spreadsheets/d/${CS_SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(CS_SHEET_NAME)}`;
  const resp = await fetch(url, { cache: 'no-cache' });
  if (!resp.ok) throw new Error(`Sheet fejl (${resp.status})`);
  const text = await resp.text();
  const anchor = text.indexOf('setResponse');
  if (anchor === -1) throw new Error('Ugyldigt GViz-svar');
  const start = text.indexOf('{', anchor);
  let i = start, depth = 0, inStr = false, esc = false;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (esc){esc=false;continue;} if(ch==='\\'){esc=true;continue;} if(ch==='"') inStr=false; }
    else { if(ch==='"') inStr=true; else if(ch==='{') depth++; else if(ch==='}'){depth--;if(depth===0){i++;break;}} }
  }
  const json = JSON.parse(text.slice(start, i));
  if (!json.table) throw new Error('Ingen tabel i GViz-svar');

  const dataRows = (json.table.rows || [])
    .map(r => (r.c || []).map(cell => (cell?.v != null ? String(cell.v) : '')))
    .filter(row => row[0] && row[0].toLowerCase() !== 'klubnavn' && row[0].toLowerCase() !== 'banenavn');

  const grouped = csGroupData(dataRows);
  localStorage.setItem(CS_CACHE_KEY, JSON.stringify(grouped));
  _sheetData = grouped;
  return grouped;
}

async function csGetSheetData() {
  if (_sheetData !== null) return _sheetData;
  try {
    const cached = localStorage.getItem(CS_CACHE_KEY);
    if (cached) {
      _sheetData = JSON.parse(cached);
      if (navigator.onLine) csFetchCoursesFromSheet().catch(() => {});
      return _sheetData;
    }
  } catch {}
  if (navigator.onLine) {
    try { return await csFetchCoursesFromSheet(); } catch(e) { console.warn('Banehentning fejlede:', e); }
  }
  return {};
}

// ── HCP-beregning ────────────────────────────────────────────

function calcPlayingHandicap(hcpIndex, slope, courseRating, par) {
  return Math.round(Number(hcpIndex) * (slope / 113) + (courseRating - par));
}

function calcStrokesPerHole(playingHandicap, holes) {
  return holes.map(h => {
    if (h.si === null) return null; // SI mangler
    if (playingHandicap >= 0) {
      return Math.floor(playingHandicap / 18) + (h.si <= (playingHandicap % 18) ? 1 : 0);
    } else {
      return h.si <= Math.abs(playingHandicap) ? -1 : 0;
    }
  });
}

function toRoman(n) {
  if (n === null || n === 0) return '';
  if (n < 0) return '−' + 'I'.repeat(Math.abs(n));
  return 'I'.repeat(n);
}

// ── Gem / hent / ryd ─────────────────────────────────────────

function csSaveCourse(klubNavn, baneNavn, tee) {
  const data = {
    courseId:   `${klubNavn}|${baneNavn}`,
    klubNavn,
    baneNavn,
    courseName: `${klubNavn} – ${baneNavn}`,
    par:        tee.par || 72,
    tee: { tee_name: tee.tee_name, course_rating: tee.course_rating, slope_rating: tee.slope_rating, holes: tee.holes }
  };
  localStorage.setItem(FGL_COURSE_KEY, JSON.stringify(data));
  return data;
}

function csSaveManualCourse(name, par) {
  const data = { courseId: 'manual', klubNavn: name, baneNavn: '', courseName: name, par: par || 72, tee: null };
  localStorage.setItem(FGL_COURSE_KEY, JSON.stringify(data));
  return data;
}

function csLoadCourse() {
  try { const r = localStorage.getItem(FGL_COURSE_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}

function csClearCourse() {
  localStorage.removeItem(FGL_COURSE_KEY);
  csUpdateCourseLabel();
}

function getSelectedCourseName() {
  const cs = csLoadCourse();
  if (!cs) return '';
  return cs.tee ? `${cs.courseName} – ${cs.tee.tee_name}` : cs.courseName;
}

// ── Slag pr. spiller ─────────────────────────────────────────

function csUpdatePlayerStrokes(player) {
  const cs = csLoadCourse();
  if (!cs || !cs.tee || !cs.tee.holes) return;

  const hcpIndex = Number(player.score?.hcp ?? 0);
  const holes    = cs.tee.holes;

  if (hcpIndex <= 0) {
    player.score.hcpOut = 0; player.score.hcpIn = 0;
    player.score.phStrokes = holes.map(() => 0);
    csUpdateHoleBadges(player, holes.map(() => 0), holes);
    return;
  }

  if (!cs.tee.course_rating || !cs.tee.slope_rating || !cs.par) return;

  const ph      = calcPlayingHandicap(hcpIndex, cs.tee.slope_rating, cs.tee.course_rating, cs.par);
  const strokes = calcStrokesPerHole(ph, holes);

  player.score.hcpOut    = strokes.slice(0, 9).reduce((a, b) => a + (b || 0), 0);
  player.score.hcpIn     = strokes.slice(9).reduce((a, b) => a + (b || 0), 0);
  player.score.phStrokes = strokes;

  const outEl = document.getElementById(`score-hcp-out-${player.id}`);
  const inEl  = document.getElementById(`score-hcp-in-${player.id}`);
  if (outEl) outEl.value = player.score.hcpOut > 0 ? player.score.hcpOut : '';
  if (inEl)  inEl.value  = player.score.hcpIn  > 0 ? player.score.hcpIn  : '';

  csUpdateHoleBadges(player, strokes, holes);
}

function csUpdateHoleBadges(player, strokes, holes) {
  holes.forEach((h, i) => {
    const badge = document.querySelector(`[data-cs-badge="${player.id}-${i}"]`);
    if (badge) {
      const s = strokes[i];
      badge.textContent = toRoman(s);
      badge.className = 'cs-stroke-badge' + (s > 0 ? ' cs-has-stroke' : s < 0 ? ' cs-plus-hcp' : '');
    }
    const siBadge = document.querySelector(`[data-cs-si="${player.id}-${i}"]`);
    if (siBadge) siBadge.textContent = h.si !== null ? h.si : '';

    const parBadge = document.querySelector(`[data-cs-par="${player.id}-${i}"]`);
    if (parBadge) parBadge.textContent = h.par !== null ? h.par : '';
  });
}

function csOnHcpChanged(player) {
  csUpdatePlayerStrokes(player);
  if (typeof savePlayers === 'function') savePlayers(players);
  const outEl = document.getElementById(`score-hcp-out-${player.id}`);
  if (outEl) outEl.dispatchEvent(new Event('change', { bubbles: true }));
}

function csUpdateAllPlayers() {
  if (typeof players !== 'undefined' && Array.isArray(players)) {
    players.forEach(p => csUpdatePlayerStrokes(p));
    if (typeof savePlayers === 'function') savePlayers(players);
    if (typeof renderPanels === 'function') renderPanels();
  }
}

// ── UI ───────────────────────────────────────────────────────

function csOpenSelector() {
  const ov = document.getElementById('courseSelectorOverlay');
  if (!ov) return;
  _csSelectedKlub = null; _csSelectedBane = null; _csSelectedTeeIdx = null; _csKlubResults = [];

  document.getElementById('courseSearchInput').value = '';
  document.getElementById('courseSearchResults').innerHTML = '';
  document.getElementById('csBaneWrapper').classList.add('hidden');
  document.getElementById('teeSelectWrapper').classList.add('hidden');
  document.getElementById('csManualWrapper').classList.add('hidden');
  document.getElementById('courseSelectorConfirm').disabled = true;

  const existing = csLoadCourse();
  document.getElementById('courseSearchInput').placeholder =
    existing ? `Nuværende: ${getSelectedCourseName()}` : 'Søg på klubnavn…';

  ov.classList.remove('hidden');
  document.body.classList.add('modal-open');
  setTimeout(() => document.getElementById('courseSearchInput').focus(), 100);
}

function csCloseSelector() {
  document.getElementById('courseSelectorOverlay').classList.add('hidden');
  document.body.classList.remove('modal-open');
}

async function csHandleSearch(query) {
  const resultsEl = document.getElementById('courseSearchResults');
  ['csBaneWrapper','teeSelectWrapper','csManualWrapper'].forEach(id =>
    document.getElementById(id).classList.add('hidden'));
  document.getElementById('courseSelectorConfirm').disabled = true;

  if (query.length < 2) { resultsEl.innerHTML = ''; return; }

  resultsEl.innerHTML = '<li class="cs-loading">Søger…</li>';
  try {
    const data = await csGetSheetData();
    const q    = query.toLowerCase();
    _csKlubResults = Object.keys(data).filter(k => k.toLowerCase().includes(q));

    if (!_csKlubResults.length) {
      resultsEl.innerHTML = '<li class="cs-empty">Ikke i listen – indtast manuelt nedenfor</li>';
      document.getElementById('csManualName').value = query;
      document.getElementById('csManualWrapper').classList.remove('hidden');
      return;
    }

    resultsEl.innerHTML = _csKlubResults.map((k, i) => `
      <li class="cs-result" data-idx="${i}" tabindex="0"><strong>${k}</strong></li>`).join('');

    resultsEl.querySelectorAll('.cs-result').forEach(li => {
      const go = () => csSelectKlub(parseInt(li.dataset.idx));
      li.addEventListener('click', go);
      li.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    });
  } catch(err) {
    resultsEl.innerHTML = '<li class="cs-empty">Fejl – prøv igen</li>';
    console.error(err);
  }
}

async function csSelectKlub(idx) {
  const klubNavn = _csKlubResults[idx];
  if (!klubNavn) return;
  _csSelectedKlub = klubNavn; _csSelectedBane = null; _csSelectedTeeIdx = null;

  document.querySelectorAll('#courseSearchResults .cs-result').forEach(li =>
    li.classList.toggle('cs-selected', parseInt(li.dataset.idx) === idx));
  document.getElementById('teeSelectWrapper').classList.add('hidden');
  document.getElementById('courseSelectorConfirm').disabled = true;

  const data  = await csGetSheetData();
  const baner = Object.keys(data[klubNavn] || {});

  // Kun én bane → vælg automatisk
  if (baner.length === 1) {
    _csSelectedBane = baner[0];
    document.getElementById('csBaneWrapper').classList.add('hidden');
    csShowTees(data[klubNavn][baner[0]], baner[0]);
    return;
  }

  // Flere baner → vis bane-dropdown
  const baneSelect = document.getElementById('baneSelect');
  baneSelect.innerHTML = '<option value="">– Vælg bane –</option>' +
    baner.map((b, i) => `<option value="${i}">${b}</option>`).join('');
  document.getElementById('csBaneWrapper').classList.remove('hidden');
}

async function csHandleBaneSelect(val) {
  if (val === '' || !_csSelectedKlub) return;
  const data    = await csGetSheetData();
  const baner   = Object.keys(data[_csSelectedKlub] || {});
  _csSelectedBane = baner[parseInt(val)];
  csShowTees(data[_csSelectedKlub][_csSelectedBane], _csSelectedBane);
}

function csShowTees(tees, baneNavn) {
  const teeWrapper = document.getElementById('teeSelectWrapper');
  const teeSelect  = document.getElementById('teeSelect');
  _csSelectedTeeIdx = null;
  document.getElementById('courseSelectorConfirm').disabled = true;

  // Kun ét teested → vælg automatisk
  if (tees.length === 1) {
    _csSelectedTeeIdx = 0;
    teeWrapper.classList.add('hidden');
    document.getElementById('courseSelectorConfirm').disabled = false;
    return;
  }

  teeSelect.innerHTML = '<option value="">– Vælg teested –</option>' +
    tees.map((t, i) => `<option value="${i}">${t.tee_name}</option>`).join('');
  teeWrapper.classList.remove('hidden');
}

function csHandleTeeSelect(val) {
  _csSelectedTeeIdx = (val === '' || !_csSelectedKlub) ? null : parseInt(val);
  document.getElementById('courseSelectorConfirm').disabled = (_csSelectedTeeIdx === null);
}

async function csConfirm() {
  if (!_csSelectedKlub || !_csSelectedBane || _csSelectedTeeIdx === null) return;
  const data = await csGetSheetData();
  const tee  = data[_csSelectedKlub][_csSelectedBane][_csSelectedTeeIdx];
  csSaveCourse(_csSelectedKlub, _csSelectedBane, tee);
  csUpdateCourseLabel();
  csCloseSelector();
  csUpdateAllPlayers();
  if (typeof openPicker === 'function') openPicker();
}

function csConfirmManual() {
  const name = (document.getElementById('csManualName').value || '').trim();
  const par  = parseInt(document.getElementById('csManualPar').value) || 72;
  if (!name) { document.getElementById('csManualName').focus(); return; }
  csSaveManualCourse(name, par);
  csUpdateCourseLabel();
  csCloseSelector();
  if (typeof openPicker === 'function') openPicker();
}

function csUpdateCourseLabel() {
  const cs  = csLoadCourse();
  const lbl = document.getElementById('currentCourseLabel');
  if (!lbl) return;
  if (!cs) { lbl.textContent = ''; return; }
  const parts = [cs.klubNavn];
  if (cs.baneNavn && cs.baneNavn !== '18 huls bane') parts.push(cs.baneNavn);
  if (cs.tee) parts.push(cs.tee.tee_name);
  lbl.textContent = parts.join(' – ') + `  ·  Par ${cs.par}`;
}

// ── Init ─────────────────────────────────────────────────────

function initCourseSelector() {
  const si = document.getElementById('courseSearchInput');
  if (si) si.addEventListener('input', e => {
    clearTimeout(_csSearchTimeout);
    _csSearchTimeout = setTimeout(() => csHandleSearch(e.target.value.trim()), 300);
  });

  const bs = document.getElementById('baneSelect');
  if (bs) bs.addEventListener('change', e => csHandleBaneSelect(e.target.value));

  const ts = document.getElementById('teeSelect');
  if (ts) ts.addEventListener('change', e => csHandleTeeSelect(e.target.value));

  const cb = document.getElementById('courseSelectorConfirm');
  if (cb) cb.addEventListener('click', csConfirm);

  const cm = document.getElementById('csManualConfirm');
  if (cm) cm.addEventListener('click', csConfirmManual);

  const cl = document.getElementById('courseSelectorClose');
  if (cl) cl.addEventListener('click', () => csCloseSelector());

  const ov = document.getElementById('courseSelectorOverlay');
  if (ov) ov.addEventListener('click', e => { if (e.target === ov) csCloseSelector(); });

  csUpdateCourseLabel();
}

document.addEventListener('DOMContentLoaded', initCourseSelector);
