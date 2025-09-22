// Bevarer v21-funktionalitet (picker, faner, sending, cache), bruger robust GViz-parsing,
// og viewer-tabel med sticky thead (KUN 1 række) + sticky første kolonne på "Total".
const STORAGE_KEY = 'fgl.players.v1';
const MAX_PLAYERS = 4;
const MIN_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;
// 4 timer

// === Afslut runde backend-konfiguration ===
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxnrBXAAL3wf1GMxZo4P-cWL-MGVPj4TtVhSHZc7Pp46VKK6aD84MfH3BIE56rUU9stCQ/exec';
const SECRET_KEY = 'O^AaXzP8aa%g8jGt@d_z_GK%y$ko$$k^#e8tq*qVzWT!OIh#14';
const AUTO_RESET_AFTER_SEND = true;
const ENABLE_OFFLINE_QUEUE = true;
const ROUND_QUEUE_KEY = 'fgl.round.queue.v1';

// Google Sheet-konfiguration (læsning)
const SHEET_ID = '113sdXTQcfODil1asdol1DCWZPcMKHQb5QTA1lj8Qn5A';
const SHEET_NAME = 'Spiller';
const SHEET_GID = '';

// Offline-cache til spillerlisten
const SHEET_CACHE_KEY = 'fgl.sheet.players.v1';
const SHEET_CACHE_META_KEY = 'fgl.sheet.players.meta.v1';
// Offline-cache til bødelisten
const FINES_CACHE_KEY = 'fgl.sheet.fines.v1';
const FINES_CACHE_META_KEY = 'fgl.sheet.fines.meta.v1';

// Dynamiske bøder
let FINES = [];
// [{id, name, type: 'count'|'check'|'derived-check', value, [source]}]
let FINE_MAP = {};
// id -> fine
function rebuildFineMap(){ FINE_MAP = Object.fromEntries(FINES.map(f => [f.id, f])); }

// UI / app-state
let players = loadPlayers();
let activePlayerId = players[0]?.id ?? null;

// Elementer
const tabsEl = document.getElementById('tabs');
const panelsEl = document.getElementById('tabPanels');
const addBtn = document.getElementById('addPlayerBtn');
const resetBtn = document.getElementById('resetBtn');

const overlay = document.getElementById('confirmOverlay');
const confirmYes = document.getElementById('confirmYes');
const confirmNo = document.getElementById('confirmNo');

const pickerOverlay = document.getElementById('pickerOverlay');
const pickerList = document.getElementById('pickerList');
const pickerClose = document.getElementById('pickerClose');
const pickerConfirm = document.getElementById('pickerConfirm');

let pickerSelected = new Set();
let sheetPlayers = [];  // [{navn, faneNavn}]
let sheetLoaded = false;
let sheetLoadError = null;
// Afslut runde elementer
const endRoundBtn = document.getElementById('endRoundBtn');
const endRoundOverlay = document.getElementById('endRoundOverlay');
const endRoundConfirmYes = document.getElementById('endRoundConfirmYes');
const endRoundConfirmNo = document.getElementById('endRoundConfirmNo');
const courseNameOverlay = document.getElementById('courseNameOverlay');
const courseNameInput = document.getElementById('courseNameInput');
const courseNameOk = document.getElementById('courseNameOk');
const courseNameCancel = document.getElementById('courseNameCancel');
// Menu / Viewer
const menuBtn = document.getElementById('menuBtn');
const menuOverlay = document.getElementById('menuOverlay');
const menuList = document.getElementById('menuList');
const menuClose = document.getElementById('menuClose');
const sheetViewer = document.getElementById('sheetViewer');
const sheetViewerTitle = document.getElementById('sheetViewerTitle');
const sheetViewerContent = document.getElementById('sheetViewerContent');
const sheetBack = document.getElementById('sheetBack');

// NYE elementer til lodtrækning
const lotteryPickerOverlay = document.getElementById('lotteryPickerOverlay');
const lotteryPickerList = document.getElementById('lotteryPickerList');
const lotteryPickerClose = document.getElementById('lotteryPickerClose');
const lotteryPickerConfirm = document.getElementById('lotteryPickerConfirm');
const lotteryResultOverlay = document.getElementById('lotteryResultOverlay');
const lotteryResultContent = document.getElementById('lotteryResultContent');
const lotteryResultClose = document.getElementById('lotteryResultClose');
let lotteryPickerSelected = new Set();


// Udled unikke faner fra Spiller-arket
function getAvailableTabsFromPlayers() {
  const names = new Set();
  const list = (sheetPlayers ?? []);
  for (const it of list) {
    const n = (it.faneNavn ?? '').toString().trim();
    if (!n) continue;
    const low = n.toLowerCase();
    if (low === 'noter' || low === 'spiller') continue;
    names.add(n);
  }
  names.add('Total');
  const arr = Array.from(names).sort((a,b) => a.localeCompare(b, 'da'));
  const idx = arr.findIndex(x => x.toLowerCase() === 'total');
  if (idx > 0) { arr.splice(idx, 1); arr.unshift('Total'); }
  return arr;
}

// ------------------------------- Utils --------------------------------
function uid(){ return 'p-' + Math.random().toString(36).slice(2, 9); }
function clamp(n, min, max){ return Math.max(min, Math.min(max, n));
}
function normalizeKey(s){ return (s ?? '').toString().trim().toLowerCase(); }
function slugify(s) {
  return (s ?? '').toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[æÆ]/g, 'ae').replace(/[øØ]/g, 'oe').replace(/[åÅ]/g, 'aa')
    .trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
function hashString(str) {
  let h = 0x811c9dc5 >>> 0;
  for (let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h,0x01000193);
}
  return (h>>>0).toString(16);
}

// Robust GViz-parser uden regex
function parseGViz(text) {
  const anchor = text.indexOf('setResponse');
  if (anchor === -1) throw new Error('Kunne ikke parse gviz-svar');
  const start = text.indexOf('{', anchor);
  if (start === -1) throw new Error('Kunne ikke parse gviz-svar');
  let i = start;
  let depth = 0, inStr = false, esc = false;
  for (; i < text.length; i++){
    const ch = text[i];
    if (inStr) {
      if (esc) { esc = false; continue;
}
      if (ch === '\\') { esc = true; continue;
}
      if (ch === '"') inStr = false;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { i++; break;
} }
    }
  }
  if (depth !== 0) throw new Error('Ugyldigt gviz-svar (ubalanserede {})');
  const jsonStr = text.slice(start, i);
  return JSON.parse(jsonStr);
}

// ---------------- Players: cache & fetch ----------------
function loadSheetCache(){
  try {
    const list = JSON.parse(localStorage.getItem(SHEET_CACHE_KEY) ?? '[]');
    const meta = JSON.parse(localStorage.getItem(SHEET_CACHE_META_KEY) ?? '{}');
    return { list, meta };
  } catch { return { list: [], meta: {} }; }
}
function saveSheetCache(list, meta = {}){
  localStorage.setItem(SHEET_CACHE_KEY, JSON.stringify(list));
  localStorage.setItem(SHEET_CACHE_META_KEY, JSON.stringify(meta));
}
function calcListHash(list){
  const norm = list.map(p => ({ navn: (p.navn ?? '').trim(), faneNavn: (p.faneNavn ?? '').trim() }))
                   .sort((a,b)=> (a.faneNavn+a.navn).localeCompare(b.faneNavn+b.navn));
  return hashString(JSON.stringify(norm));
}

async function fetchSheetPlayersFromNetwork(){
  sheetLoadError = null;
  const base = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;
  const where = SHEET_GID
    ? `${base}&gid=${encodeURIComponent(SHEET_GID)}`
    : `${base}&sheet=${encodeURIComponent(SHEET_NAME)}`;
  const url = `${where}&range=A:B&headers=1`;
  const resp = await fetch(url, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`Hentning fejlede (${resp.status})`);
  const text = await resp.text();

  const json = parseGViz(text);
  if (!json.table) throw new Error('Ugyldigt gviz-svar (mangler table)');
  const label = s => (s ?? '').toString().trim().replace(/:$/, '').toLowerCase();
  const cols = (json.table.cols ?? []).map(c => label(c.label));
  let idxNavn = cols.indexOf('navn');
  let idxFane = cols.indexOf('fane navn');
  const rows = json.table.rows ?? [];
  if (idxNavn === -1 || idxFane === -1) {
    let headerRow = null;
    for (const r of rows) { const a=label(r.c?.[0]?.v), b=label(r.c?.[1]?.v); if (a && b) { headerRow = r; break;
} }
    if (headerRow) {
      const a=label(headerRow.c?.[0]?.v), b=label(headerRow.c?.[1]?.v);
      if (a==='navn') idxNavn=0;
      if (b==='fane navn') idxFane=1;
    }
  }
  if (idxNavn === -1) throw new Error('Kolonnen "Navn" blev ikke fundet.');
  const result = [];
  let started = false;
  for (const r of rows) {
    if (!started) {
      const a=label(r.c?.[0]?.v), b=label(r.c?.[1]?.v);
      if (a==='navn' && b==='fane navn') { started = true; continue;
}
    }
    const c = r.c ?? [];
    const navn = (c[idxNavn]?.v ?? '').toString().trim();
    const fane = (idxFane >= 0 ? (c[idxFane]?.v ?? '') : '').toString().trim();
    if (navn) result.push({ navn, faneNavn: fane || navn });
  }
  return result;
}

async function refreshSheetPlayersIfOnline(minAgeMs = 0){
  const { meta } = loadSheetCache();
  if (minAgeMs && meta?.updatedAt && (Date.now() - meta.updatedAt) < minAgeMs) return { changed: false, reason: 'fresh-enough' };
  if (!navigator.onLine) return { changed: false, reason: 'offline' };
  try {
    const fresh = await fetchSheetPlayersFromNetwork();
    const newHash = calcListHash(fresh);
    if (newHash !== meta?.hash){
      saveSheetCache(fresh, { hash: newHash, updatedAt: Date.now() });
      sheetPlayers = fresh; sheetLoaded = true;
      return { changed: true };
    }
    return { changed: false, reason: 'no-change' };
  } catch (err) {
    sheetLoadError = err; return { changed: false, reason: 'error', error: err };
  }
}

// --- Hent hele fanen som 2D-array
async function fetchSheetTabAsTable(tabName){
  const base = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;
  const url = `${base}&sheet=${encodeURIComponent(tabName)}`;
  const resp = await fetch(url, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`Hentning fejlede (${resp.status})`);
  const text = await resp.text();

  const json = parseGViz(text);
  if (!json.table) throw new Error('Ugyldigt gviz-svar (mangler table)');
  const cols = (json.table.cols ?? []);
  const rows = (json.table.rows ?? []);
  const out = [];
  // Header-række (labels)
  if (cols.length) out.push(cols.map(c => (c?.label ?? '').toString()));
  // Data-rækker
  for (const r of rows) {
    const c = r.c ?? [];
    const row = c.map(cell => {
      if (!cell) return '';
      const f = (cell.f != null) ? String(cell.f) : null;
      const v = (cell.v != null) ? String(cell.v) : '';
      return f ?? v;
    });
    let last = row.length - 1;
    while (last >= 0 && (row[last] == null || row[last] === '')) last--;
    out.push(row.slice(0, last + 1));
  }
  while (out.length && out[out.length - 1].every(x => (x ?? '') === '')) out.pop();
  return out;
}

// ---------------- Viewer ----------------
function openSheetViewer(tabName) {
  sheetViewerTitle.textContent = tabName;
  sheetViewerContent.innerHTML = '<div class="sheet-empty">Indlæser…</div>';
  sheetViewer.classList.remove('hidden');
  if (!navigator.onLine) {
    sheetViewerContent.innerHTML = `
      <div class="sheet-offline">
        <strong>Ikke online.</strong> Kunne ikke hente data fra arket.<br/>
        Prøv igen, når du er online.
      </div>`;
    return;
  }

  (async () => {
    try {
      const table = await fetchSheetTabAsTable(tabName);
      if (!table.length) {
        sheetViewerContent.innerHTML = '<div class="sheet-empty">Intet indhold i arket.</div>';
        return;
      }
      const sticky = tabName.toLowerCase() === 'total';
      const html = renderArrayAsHtmlTable(table, {
        stickyFirstCol: sticky,
        stickyTopRows:  sticky // kun 1 sticky-række i <thead>
      });
      sheetViewerContent.innerHTML = html;
      // (Ingen initStickyViewerTables nødvendig, da vi kun fryser 1 række)
    } catch (err) {
      sheetViewerContent.innerHTML = `
        <div class="sheet-offline">
          <strong>Fejl:</strong> ${String(err)}
        </div>`;
    }
  })();
}
function closeSheetViewer() {
  sheetViewer.classList.add('hidden');
  sheetViewerContent.innerHTML = '';
}

// Renders tabellen – stickyTopRows=true => KUN 1 header-række i <thead>
function renderArrayAsHtmlTable(arr, opts = {}) {
  const { stickyFirstCol = false, stickyTopRows = false } = opts;
  const [header, ...bodyRows] = arr;

  const cls = 'sheet-table'
    + (stickyFirstCol ? ' sticky-first-col' : '')
    + (stickyTopRows ? ' sticky-top-rows' : '');
  const theadHtml = header
    ? `<thead><tr>${header.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>`
    : '';
  const tbodyHtml = bodyRows.length
    ? `<tbody>${bodyRows.map(r => `<tr>${r.map(v => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`).join('')}</tbody>`
    : '';
  return `<table class="${cls}">${theadHtml}${tbodyHtml}</table>`;
}

function escapeHtml(s) {
  // (Bevarer oprindelig mapping; ændres ikke for at undgå sideeffekter)
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&':'&','<':'<','>':'>','"':'"',"'":'&#39;'
  }[m]));
}

// Tilbage-knap
if (sheetBack) sheetBack.addEventListener('click', closeSheetViewer);

// Opdater viewer hvis forbindelsen kommer tilbage mens den er åben
window.addEventListener('online', () => {
  if (!sheetViewer.classList.contains('hidden')) {
    const tabName = sheetViewerTitle.textContent || '';
    if (tabName) openSheetViewer(tabName);
  }
});

// ---------------- Fines: cache & fetch ----------------
function loadFinesCache(){
  try {
    const list = JSON.parse(localStorage.getItem(FINES_CACHE_KEY) ?? '[]');
    const meta = JSON.parse(localStorage.getItem(FINES_CACHE_META_KEY) ?? '{}');
    return { list, meta };
  } catch { return { list: [], meta: {} }; }
}
function saveFinesCache(list, meta = {}){
  localStorage.setItem(FINES_CACHE_KEY, JSON.stringify(list));
  localStorage.setItem(FINES_CACHE_META_KEY, JSON.stringify(meta));
}
function calcFinesHash(list){
  const norm = list.map(f=>({ name:(f.name??'').trim(), value:Number(f.value??0), type:(f.type??'').trim().toLowerCase() }));
  return hashString(JSON.stringify(norm));
}

async function fetchFinesFromNetwork(){
  const base = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;
  const where = SHEET_GID
    ? `${base}&gid=${encodeURIComponent(SHEET_GID)}`
    : `${base}&sheet=${encodeURIComponent(SHEET_NAME)}`;
  const url = `${where}&range=D:F&headers=1`;

  const resp = await fetch(url, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`Bøder: hentning fejlede (${resp.status})`);
  const text = await resp.text();

  const json = parseGViz(text);
  if (!json.table) throw new Error('Bøder: ugyldigt gviz-svar (mangler table)');

  const label = s => (s ?? '').toString().trim().replace(/:$/, '').toLowerCase();
  const isName  = x => ['bøde','bode','fine','name'].includes(x);
  const isValue = x => ['værdi','vaerdi','value','beløb','beloeb'].includes(x);
  const isType  = x => ['type','kategori'].includes(x);
  const cols = (json.table.cols ?? []).map(c => label(c.label));
  let idxName = cols.findIndex(isName),
      idxValue = cols.findIndex(isValue),
      idxType = cols.findIndex(isType);
  const rows = json.table.rows ?? [];

  if (idxName === -1 || idxValue === -1 || idxType === -1) {
    let headerRow = null;
    for (const r of rows) {
      const a = label(r.c?.[0]?.v), b = label(r.c?.[1]?.v), c = label(r.c?.[2]?.v);
      if (a && b && c) { headerRow = r; break;
}
    }
    if (headerRow) {
      const a = label(headerRow.c?.[0]?.v), b = label(headerRow.c?.[1]?.v), c = label(headerRow.c?.[2]?.v);
      if (isName(a))  idxName  = 0;
      if (isValue(b)) idxValue = 1;
      if (isType(c))  idxType  = 2;
    }
  }

  if (idxName  === -1) throw new Error('Bøder: kolonnen "Bøde/fine" blev ikke fundet (i D:F).');
  if (idxValue === -1) throw new Error('Bøder: kolonnen "Værdi/value" blev ikke fundet (i D:F).');
  if (idxType  === -1) throw new Error('Bøder: kolonnen "Type" blev ikke fundet (i D:F).');

  const list = [];
  let started = false;
  for (const r of rows) {
    if (!started) {
      const a = label(r.c?.[0]?.v), b = label(r.c?.[1]?.v), c = label(r.c?.[2]?.v);
      if (isName(a) && isValue(b) && isType(c)) { started = true; continue;
}
    }
    const c = r.c ?? [];
    const name = (c[idxName]?.v ?? '').toString().trim();
    if (!name) continue;
    const value = Number((c[idxValue]?.v ?? 0)) || 0;
    let type = (c[idxType]?.v ?? '').toString().trim().toLowerCase();
    const item = { id: slugify(name), name, value, type: (type === 'derived-check' ? 'derived-check' : (type === 'check' ? 'check' : 'count')) };
    if (slugify(name) === 'alle-green-misset') { item.type = 'derived-check'; item.source = slugify('Misset Green'); }
    list.push(item);
  }
  return list;
}

async function refreshFinesIfOnline(minAgeMs = 0){
  const { meta } = loadFinesCache();
  if (minAgeMs && meta?.updatedAt && (Date.now() - meta.updatedAt) < minAgeMs) return { changed: false, reason: 'fresh-enough' };
  if (!navigator.onLine) return { changed: false, reason: 'offline' };
  try {
    const fresh = await fetchFinesFromNetwork();
    const newHash = calcFinesHash(fresh);
    if (newHash !== meta?.hash){
      saveFinesCache(fresh, { hash: newHash, updatedAt: Date.now() });
      return { changed: true };
    }
    return { changed: false, reason: 'no-change' };
  } catch (err) {
    console.error(err);
    return { changed: false, reason: 'error', error: err };
  }
}

async function ensureFinesLoaded(minAgeMs = 0, showToastOnChange = true){
  let loaded = false;
  const cached = loadFinesCache();
  if (cached.list && cached.list.length){
    FINES = cached.list; rebuildFineMap(); migratePlayersForFines(); loaded = true;
  }
  const { changed } = await refreshFinesIfOnline(minAgeMs);
  if (changed){
    const updated = loadFinesCache().list;
    if (updated.length){
      FINES = updated; rebuildFineMap(); migratePlayersForFines();
      if (players.length) renderPanels();
      if (showToastOnChange) showToast('Bøder opdateret');
      loaded = true;
    }
  }
  return loaded;
}

// ---------------- Persistens for spillere ----------------
function loadPlayers() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    let migrated = false;
    parsed.forEach(p => {
      if (!p.rows) return;
      const brokSum = (p.rows['brok'] ?? 0) + (p.rows['brok-1'] ?? 0) + (p.rows['brok-2'] ?? 0);
      if (brokSum !== (p.rows['brok'] ?? 0)) { p.rows['brok'] = brokSum; migrated = true; }
      delete p.rows['brok-1']; delete p.rows['brok-2'];
      const fsSum = (p.rows['forkert-scorekort'] ?? 0) + (p.rows['forkert-scorekort-1'] ?? 0) + (p.rows['forkert-scorekort-2'] ?? 0);
      if (fsSum !== (p.rows['forkert-scorekort'] ?? 0)) { p.rows['forkert-scorekort'] = fsSum; migrated = true; }
      delete p.rows['forkert-scorekort-1']; delete p.rows['forkert-scorekort-2'];
    });
    if (migrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    return parsed;
  } catch { return [];
}
}
function savePlayers(players){ localStorage.setItem(STORAGE_KEY, JSON.stringify(players)); }
function migratePlayersForFines(){
  let migrated = false;
  players.forEach(p => {
    if (!p.rows) p.rows = {};
    FINES.forEach(f => {
      if (p.rows[f.id] === undefined) { p.rows[f.id] = (f.type === 'count' ? 0 : false); migrated = true; }
    });
  });
  if (migrated) savePlayers(players);
}

// ---------------- Forretningslogik ----------------
function getFineValue(id){ return Number(FINE_MAP[id]?.value ?? 0); }
function createEmptyRows(){ const rows = {};
  for (const fine of FINES) rows[fine.id] = fine.type === 'count' ? 0 : false; return rows;
}
function hasDuplicate(displayName, meta){
  const key = normalizeKey(displayName);
  if (players.some(p => normalizeKey(p.name) === key)) return true;
  if (meta?.navn){
    const nkey = normalizeKey(meta.navn);
    if (players.some(p => normalizeKey(p.meta?.navn ?? p.name) === nkey)) return true;
  }
  return false;
}
function addPlayer(displayName, meta = null){
  if (!displayName || !displayName.trim()) return;
  if (players.length >= MAX_PLAYERS) { alert(`Du kan højst tilføje ${MAX_PLAYERS} spillere.`); return; }
  if (hasDuplicate(displayName, meta)) { return;
}
  if (!FINES.length) { alert('Bøder indlæses første gang. Prøv igen om et øjeblik (eller gå online).'); return;
}
  const p = { id: uid(), name: displayName.trim(), rows: createEmptyRows(), meta: meta ?? undefined };
  players.push(p);
  activePlayerId = p.id; savePlayers(players); render();
}
function setActivePlayer(playerId){ activePlayerId = playerId; renderTabs(); renderPanels(); }
function removeAllPlayers(){ players = []; activePlayerId = null;
savePlayers(players); render(); }

// ---------------- Rendering ----------------
function render(){
  resetBtn.classList.toggle('hidden', players.length === 0);
  if (endRoundBtn) endRoundBtn.classList.toggle('hidden', players.length === 0);
  document.body.classList.toggle('empty-state', players.length === 0);
  if (menuBtn) menuBtn.classList.toggle('hidden', players.length > 0);
  renderTabs(); renderPanels();
}
function renderTabs(){
  tabsEl.innerHTML = '';
  players.forEach(p => {
    const b = document.createElement('button');
    b.className = 'tab-btn' + (p.id === activePlayerId ? ' active' : '');
    b.textContent = p.name;
    b.addEventListener('click', () => setActivePlayer(p.id));
    tabsEl.appendChild(b);
  });
}
function buildTableForPlayer(p){
  const table = document.createElement('table'); table.className = 'table';
  const thead = document.createElement('thead'); thead.innerHTML = `<tr><th>Bøder:</th><th class="count">Antal:</th><th class="amount">Beløb:</th></tr>`; table.appendChild(thead);
  const tbody = document.createElement('tbody');
  let sectionBreakInserted = false;
  FINES.forEach((fine) => {
    const tr = document.createElement('tr');
    const tdLabel = document.createElement('td'); tdLabel.className = 'row-label'; tdLabel.textContent = fine.name;
    const tdCount = document.createElement('td'); tdCount.className = 'count';
    const tdAmt = document.createElement('td'); tdAmt.className = 'amount';

    if (fine.type === 'count') {
      const wrap = document.createElement('div'); wrap.className = 'counter';
      const minus = document.createElement('button'); minus.className = 'iconbtn minus'; minus.textContent = '−';
      const input = document.createElement('input');
      // RETTET LINJE:
      input.type = 'number'; input.min = '0'; input.step = '1'; input.className = 'num'; input.value = p.rows[fine.id] ?? 0;
      const plus = document.createElement('button'); plus.className = 'iconbtn plus'; plus.textContent = '+';
      wrap.append(minus, input, plus);
      minus.addEventListener('click', () => { input.value = clamp(parseInt(input.value ?? '0',10)-1, 0, 9999);
p.rows[fine.id] = Number(input.value); savePlayers(players); updateAmounts(table, p); });
      plus.addEventListener('click', () => { input.value = clamp(parseInt(input.value ?? '0',10)+1, 0, 9999); p.rows[fine.id] = Number(input.value); savePlayers(players); updateAmounts(table, p); });
      input.addEventListener('change', () => { input.value = clamp(parseInt(input.value ?? '0',10), 0, 9999); p.rows[fine.id] = Number(input.value); savePlayers(players); updateAmounts(table, p); });
      tdCount.appendChild(wrap);
    } else {
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!p.rows[fine.id];
      cb.addEventListener('change', () => { p.rows[fine.id] = cb.checked; savePlayers(players); updateAmounts(table, p); });
      tdCount.appendChild(cb);
    }

    const amtInput = document.createElement('input');
    amtInput.type = 'text'; amtInput.className = 'amount-field'; amtInput.readOnly = true; amtInput.value = '0'; amtInput.dataset.fineId = fine.id;
    tdAmt.appendChild(amtInput);
    tr.append(tdLabel, tdCount, tdAmt); tbody.appendChild(tr);
    if (!sectionBreakInserted && fine.id === 'hole-in-one') {
      const gap = document.createElement('tr');
      gap.innerHTML = `<td class="section-gap"></td><td class="section-gap"></td><td class="section-gap"></td>`;
      tbody.appendChild(gap);
      sectionBreakInserted = true;
    }
  });

  const tfoot = document.createElement('tfoot');
  const trTot = document.createElement('tr');
  const tdLbl = document.createElement('td'); tdLbl.textContent = 'At betale:'; tdLbl.className = 'row-label';
  const tdEmpty = document.createElement('td');
  const tdTot = document.createElement('td');
  const totalInput = document.createElement('input'); totalInput.type = 'text'; totalInput.readOnly = true; totalInput.className = 'amount-field total-field';
  totalInput.value = '0'; totalInput.id = 'total-for-' + p.id;
  tdTot.appendChild(totalInput);
  trTot.append(tdLbl, tdEmpty, tdTot); tfoot.appendChild(trTot);

  table.appendChild(tbody); table.appendChild(tfoot);
  updateAmounts(table, p);
  return table;
}
function renderPanels(){
  panelsEl.innerHTML = '';
  if (players.length === 0) return;
  const panel = document.createElement('section'); panel.className = 'panel';
  const p = players.find(x => x.id === activePlayerId) ?? players[0];
  if (p) panel.appendChild(buildTableForPlayer(p));
  panelsEl.appendChild(panel);
}
function calcAmount(player, fine){
  if (!fine) return 0;
  if (fine.type === 'count') { const n = Number(player.rows[fine.id] ?? 0);
  const v = getFineValue(fine.id); return n * v; }
  if (fine.type === 'check') { const v = getFineValue(fine.id);
  return player.rows[fine.id] ? v : 0; }
  if (fine.type === 'derived-check') {
    if (!player.rows[fine.id]) return 0;
    const src = FINE_MAP[fine.source];
    return calcAmount(player, src);
  }
  return 0;
}
function updateAmounts(table, player){
  let total = 0;
  for (const fine of FINES){
    const amtInput = table.querySelector(`input[data-fine-id="${fine.id}"]`);
    if (!amtInput) continue;
    const amount = calcAmount(player, fine);
    amtInput.value = amount.toString();
    total += amount;
  }
  const totalInput = table.querySelector('#total-for-' + player.id);
  if (totalInput) totalInput.value = total.toString();
}

// ---------------- Afslut runde: data & send ----------------
function buildFinesForPlayer(player){
  const finesOut = [];
  for (const fine of FINES) {
    const val = player.rows[fine.id];
    const count = (fine.type === 'count') ? Number(val ?? 0) : (val ? 1 : 0);
    const amount = calcAmount(player, fine);
    finesOut.push({ id: fine.id, name: fine.name, count, amount });
  }
  return finesOut;
}
function buildPayloadForPlayer(player, courseName){
  const timestamp = new Date().toISOString();
  return {
    secret: SECRET_KEY,
    sheetTab: player.name,
    tableName: `${courseName} (${new Date().toLocaleString('da-DK')})`,
    fines: buildFinesForPlayer(player),
    meta: { courseName, player: player.name, at: timestamp, app: 'FGL_PWA_v18' }
  };
}
async function sendRoundData(payload){
  const resp = await fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    redirect: 'follow',
    body: JSON.stringify(payload)
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text);
}
  catch { throw new Error('Ugyldigt svar fra serveren (ikke JSON)'); }
  if (!resp.ok) throw new Error(`Serverfejl: ${resp.status}`);
  if (!data || data.status !== 'ok') throw new Error(data?.message || 'Server svarede uden status ok');
  return data;
}
function queuePush(item){
  if (!ENABLE_OFFLINE_QUEUE) return;
  try { const q = JSON.parse(localStorage.getItem(ROUND_QUEUE_KEY) || '[]'); q.push(item); localStorage.setItem(ROUND_QUEUE_KEY, JSON.stringify(q));
} catch {}
}
function queueDrain(){
  if (!ENABLE_OFFLINE_QUEUE) return;
  try {
    const q = JSON.parse(localStorage.getItem(ROUND_QUEUE_KEY) || '[]');
    if (!q.length) return;
    (async () => {
      const remain = [];
      for (const item of q) {
        try { await sendRoundData(item); }
        catch { remain.push(item); }
      }
      localStorage.setItem(ROUND_QUEUE_KEY, JSON.stringify(remain));
      if (q.length !== remain.length) showToast('Afventende runder sendt');
    })();
  } catch {}
}
function fullResetLikeButton(){ localStorage.removeItem(STORAGE_KEY); removeAllPlayers(); }

async function finishRoundFlow(courseName){
  if (!players.length) return;
  showToast('Indsender...');
  const errors = [];
  for (const p of players) {
    const payload = buildPayloadForPlayer(p, courseName);
    if (!navigator.onLine && ENABLE_OFFLINE_QUEUE) { queuePush(payload);
continue; }
    try { await sendRoundData(payload); }
    catch (err) {
      console.error('Send fejl for', p.name, err);
      errors.push(`${p.name}: ${err.message || err}`);
      if (ENABLE_OFFLINE_QUEUE) queuePush(payload);
    }
  }
  if (errors.length === 0) { showToast('Runde afsluttet');
}
  else { showToast('Nogle indsendelser blev køet til senere'); }
  if (AUTO_RESET_AFTER_SEND) fullResetLikeButton();
}

// ---------------- Picker (Tilføj spiller) ----------------
function remainingSlots(){ return Math.max(0, MAX_PLAYERS - players.length); }
function openPicker(){
  document.body.classList.add('modal-open');
  pickerOverlay.classList.remove('hidden');
  pickerSelected = new Set();
  updatePickerConfirm();

  const cached = loadSheetCache();
  if (cached.list && cached.list.length){ sheetPlayers = cached.list; sheetLoaded = true; renderPickerList(false);
}
  else { renderPickerList(true); }

  ensureFinesLoaded(0).then(()=>{});
  refreshSheetPlayersIfOnline(MIN_REFRESH_INTERVAL_MS).then(()=> renderPickerList(false)).catch(()=> renderPickerList(false));
}
function closePicker(){ pickerOverlay.classList.add('hidden'); document.body.classList.remove('modal-open'); pickerSelected = new Set();
}
function updatePickerConfirm(){
  const count = pickerSelected.size;
  pickerConfirm.textContent = count>0 ? `OK (${count})` : 'OK';
  pickerConfirm.disabled = (count === 0) || (remainingSlots() === 0);
}
function renderPickerList(isLoading = false){
  pickerList.innerHTML = '';
  if (isLoading) { pickerList.innerHTML = `<div class="picker-item"><span class="primary-label">Indlæser spillere…</span></div>`; return;
}
  if (sheetLoadError) { pickerList.innerHTML = `<div class="picker-item"><span class="primary-label">Kunne ikke hente fra arket: ${sheetLoadError.message}</span></div>`; return;
}

  const { meta } = loadSheetCache();
  if (meta.updatedAt){
    const info = document.createElement('div'); info.className = 'picker-item';
    info.style.opacity = '0.7';
    const ts = new Date(meta.updatedAt).toLocaleString('da-DK');
    info.innerHTML = `<span class="primary-label">Sidst opdateret: ${ts}</span>`;
    pickerList.appendChild(info);
  }

  const items = sheetPlayers;
  if (items.length === 0){
    const hasCache = (loadSheetCache().list ?? []).length > 0;
    const msg = (!hasCache && !navigator.onLine) ? 'Ingen cache tilgængelig – gå online første gang for at hente spillerlisten.'
: 'Ingen matches';
    pickerList.innerHTML = `<div class="picker-item"><span class="primary-label">${msg}</span></div>`;
    return;
  }

  const existingKeys = new Set([
    ...players.map(p => (p.name ?? '').toLowerCase()),
    ...players.map(p => ((p.meta?.navn) ?? '').toLowerCase()),
  ]);
  const frag = document.createDocumentFragment();
  items.forEach(item => {
    const row = document.createElement('div'); row.className = 'picker-item'; row.setAttribute('role', 'option');

    const left = document.createElement('div');
    const primary = document.createElement('div'); primary.className = 'primary-label'; primary.textContent = item.navn;
    left.append(primary);

    const key = `${item.faneNavn}\n${item.navn}`;
    const exists = existingKeys.has((item.faneNavn ?? '').toLowerCase()) || existingKeys.has((item.navn ?? '').toLowerCase());

    const right = document.createElement('div');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'selbox'; cb.checked = pickerSelected.has(key);

    const noRoom = (remainingSlots() - (pickerSelected.has(key) ? (pickerSelected.size-1) : pickerSelected.size)) <= 0;
    cb.disabled = exists || noRoom;

    function toggle(){
      if (exists) return;
      const selectedAlready = pickerSelected.has(key);
      if (!selectedAlready && pickerSelected.size >= remainingSlots()) { return;
}
      if (selectedAlready) pickerSelected.delete(key); else pickerSelected.add(key);
      cb.checked = pickerSelected.has(key);
      updatePickerConfirm();
      renderPickerList();
    }

    row.addEventListener('click', (e) => { if (e.target !== cb) toggle(); });
    cb.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });

    if (exists) row.classList.add('disabled');
    right.appendChild(cb);
    row.append(left, right);
    frag.appendChild(row);
  });
  pickerList.appendChild(frag);
}

// Confirm-knap i picker
pickerConfirm.addEventListener('click', async () => {
  await ensureFinesLoaded(0, false);
  if (!FINES.length) { alert('Bøder kunne ikke hentes første gang. Gå online og prøv igen.'); return; }
  const selectedKeys = Array.from(pickerSelected);
  if (selectedKeys.length === 0) return;

  const items = sheetPlayers;
  let slots = remainingSlots();
  for (const it of items){
    const key = `${it.faneNavn}\n${it.navn}`;
    if (!selectedKeys.includes(key)) continue;
    if (slots <= 0) break;
    const display = it.faneNavn || it.navn;
    if (!hasDuplicate(display, { navn: it.navn })) { addPlayer(display, { navn: it.navn }); slots--; }
  }
  closePicker();
});

// ---------------- MENU: Åbn/luk ----------------
function openMenu() {
  document.body.classList.add('modal-open');
  menuOverlay.classList.remove('hidden');
  // 1) Brug cache straks
  const cached = loadSheetCache();
  if (cached.list && cached.list.length) { sheetPlayers = cached.list;
  sheetLoaded = true; }
  renderMenuList();

  // 2) Forsøg frisk netværks-hentning – tegn igen uanset hash
  refreshSheetPlayersIfOnline(MIN_REFRESH_INTERVAL_MS)
    .finally(() => {
      const c2 = loadSheetCache();
      if (c2.list && c2.list.length) sheetPlayers = c2.list;
      renderMenuList();
    });
}
function closeMenu() {
  menuOverlay.classList.add('hidden');
  document.body.classList.remove('modal-open');
}
function renderMenuList() {
  const tabs = getAvailableTabsFromPlayers();
  menuList.innerHTML = ''; // Nulstil listen

  // Overskrift for bødekort
  const headingFines = document.createElement('div');
  headingFines.className = 'menu-heading';
  headingFines.textContent = 'Bøde Kort:';
  menuList.appendChild(headingFines);

  if (!tabs.length) {
    const item = document.createElement('div');
    item.className = 'menu-item';
    item.innerHTML = `<span class="name">Ingen faner fundet</span>`;
    menuList.appendChild(item);
  } else {
    const frag = document.createDocumentFragment();
    tabs.forEach(name => {
      const row = document.createElement('div');
      row.className = 'menu-item';
      const left = document.createElement('div');
      left.className = 'name';
      left.textContent = name;
      row.append(left);
      row.addEventListener('click', () => { closeMenu(); openSheetViewer(name); });
      frag.appendChild(row);
    });
    menuList.appendChild(frag);
  }

  // Overskrift for lodtrækning
  const headingLottery = document.createElement('div');
  headingLottery.className = 'menu-heading';
  headingLottery.textContent = 'Lodtrækning:';
  menuList.appendChild(headingLottery);

  // Menupunkt for lodtrækning
  const lotteryItem = document.createElement('div');
  lotteryItem.className = 'menu-item';
  lotteryItem.innerHTML = '<div class="name">Vælg spiller</div>';
  lotteryItem.addEventListener('click', () => {
    closeMenu();
    openLotteryPicker();
  });
  menuList.appendChild(lotteryItem);
}


// ---------------- Lodtrækning: Picker, logik og resultat ----------------

/*function openLotteryPicker() {
  document.body.classList.add('modal-open');
  lotteryPickerOverlay.classList.remove('hidden');
  lotteryPickerSelected = new Set();
  updateLotteryPickerConfirm();

  const cached = loadSheetCache();
  if (cached.list && cached.list.length){
    sheetPlayers = cached.list;
    sheetLoaded = true;
    renderLotteryPickerList(false);
  } else {
    renderLotteryPickerList(true);
  }
  refreshSheetPlayersIfOnline(MIN_REFRESH_INTERVAL_MS)
    .then(()=> renderLotteryPickerList(false))
    .catch(()=> renderLotteryPickerList(false));
}*/

function openLotteryPicker() {
  document.body.classList.add('modal-open');
  lotteryPickerOverlay.classList.remove('hidden');

  const cached = loadSheetCache();
  if (cached.list && cached.list.length){
    sheetPlayers = cached.list;
    sheetLoaded = true;

    //  Vælg spillere her – fx alle spillere
    lotteryPickerSelected = new Set(sheetPlayers.map(p => p.navn));

    updateLotteryPickerConfirm();
    renderLotteryPickerList(false);
  } else {
    lotteryPickerSelected = new Set(); // Tom hvis ingen cache
    updateLotteryPickerConfirm();
    renderLotteryPickerList(true);
  }

  refreshSheetPlayersIfOnline(MIN_REFRESH_INTERVAL_MS)
    .then(() => {
      // Vælg spillere igen efter opdatering
      lotteryPickerSelected = new Set(sheetPlayers.map(p => p.navn));
      updateLotteryPickerConfirm();
      renderLotteryPickerList(false);
    })
    .catch(() => renderLotteryPickerList(false));
}


function closeLotteryPicker() {
  lotteryPickerOverlay.classList.add('hidden');
  document.body.classList.remove('modal-open');
  lotteryPickerSelected = new Set();
}

function updateLotteryPickerConfirm() {
  const count = lotteryPickerSelected.size;
  lotteryPickerConfirm.textContent = count > 0 ? `OK (${count})` : 'OK';
  lotteryPickerConfirm.disabled = (count === 0);
}

function renderLotteryPickerList(isLoading = false) {
  lotteryPickerList.innerHTML = '';
  if (isLoading) {
    lotteryPickerList.innerHTML = `<div class="picker-item"><span class="primary-label">Indlæser spillere…</span></div>`;
    return;
  }
  if (sheetLoadError) {
    lotteryPickerList.innerHTML = `<div class="picker-item"><span class="primary-label">Kunne ikke hente fra arket: ${sheetLoadError.message}</span></div>`;
    return;
  }

  const items = sheetPlayers;
  if (items.length === 0){
    const hasCache = (loadSheetCache().list ?? []).length > 0;
    const msg = (!hasCache && !navigator.onLine) ? 'Ingen cache tilgængelig – gå online første gang for at hente spillerlisten.' : 'Ingen spillere fundet';
    lotteryPickerList.innerHTML = `<div class="picker-item"><span class="primary-label">${msg}</span></div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  items.forEach(item => {
    const key = item.navn; // Brug unikt spillernavn som nøgle
    if (!key) return;

    const row = document.createElement('div');
    row.className = 'picker-item';
    row.setAttribute('role', 'option');

    const left = document.createElement('div');
    const primary = document.createElement('div');
    primary.className = 'primary-label';
    primary.textContent = item.navn;
    left.append(primary);

    const right = document.createElement('div');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'selbox';
    cb.checked = lotteryPickerSelected.has(key);

    function toggle() {
      if (lotteryPickerSelected.has(key)) {
        lotteryPickerSelected.delete(key);
      } else {
        lotteryPickerSelected.add(key);
      }
      cb.checked = lotteryPickerSelected.has(key);
      updateLotteryPickerConfirm();
    }

    row.addEventListener('click', (e) => { if (e.target !== cb) toggle(); });
    cb.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });

    right.appendChild(cb);
    row.append(left, right);
    frag.appendChild(row);
  });
  lotteryPickerList.appendChild(frag);
}

function runLottery() {
  const selectedPlayers = Array.from(lotteryPickerSelected);
  if (selectedPlayers.length === 0) return;

  // 1. Bland spillere (Fisher-Yates shuffle)
  for (let i = selectedPlayers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [selectedPlayers[i], selectedPlayers[j]] = [selectedPlayers[j], selectedPlayers[i]];
  }

  // 2. Bestem antal grupper
  const numPlayers = selectedPlayers.length;
  const numGroups = numPlayers >= 9 ? 3 : 2;

  // 3. Fordel spillere i grupper
  const groups = Array.from({ length: numGroups }, () => []);
  for (let i = 0; i < numPlayers; i++) {
    groups[i % numGroups].push(selectedPlayers[i]);
  }

  // 4. Vis resultat
  showLotteryResult(groups);
}

function showLotteryResult(groups) {
  let html = '';
  groups.forEach((players, index) => {
    html += `<h4>Gruppe ${index + 1}</h4>`;
    html += '<ul>';
    players.forEach(player => {
      html += `<li>${escapeHtml(player)}</li>`;
    });
    html += '</ul>';
  });

  lotteryResultContent.innerHTML = html;
  document.body.classList.add('modal-open');
  lotteryResultOverlay.classList.remove('hidden');
}

function closeLotteryResult() {
    lotteryResultOverlay.classList.add('hidden');
    document.body.classList.remove('modal-open');
}

// ---------------- Events ----------------
if (menuBtn) menuBtn.addEventListener('click', openMenu);
if (menuClose) menuClose.addEventListener('click', closeMenu);
if (menuOverlay) menuOverlay.addEventListener('click', (e) => {
  if (e.target === menuOverlay) closeMenu();
});

addBtn.addEventListener('click', openPicker);
pickerClose.addEventListener('click', closePicker);
pickerOverlay.addEventListener('click', (e) => { if (e.target === pickerOverlay) closePicker(); });

resetBtn.addEventListener('click', () => { document.body.classList.add('modal-open'); overlay.classList.remove('hidden'); });
confirmNo.addEventListener('click', () => { overlay.classList.add('hidden'); document.body.classList.remove('modal-open'); });
confirmYes.addEventListener('click', () => { overlay.classList.add('hidden'); document.body.classList.remove('modal-open'); localStorage.removeItem(STORAGE_KEY); removeAllPlayers(); });
// Afslut runde dialogs
if (endRoundBtn) { endRoundBtn.addEventListener('click', () => { document.body.classList.add('modal-open'); endRoundOverlay.classList.remove('hidden'); });
}
if (endRoundConfirmNo) { endRoundConfirmNo.addEventListener('click', () => { endRoundOverlay.classList.add('hidden'); document.body.classList.remove('modal-open'); });
}
if (endRoundConfirmYes) { endRoundConfirmYes.addEventListener('click', () => { endRoundOverlay.classList.add('hidden'); courseNameInput.value = ''; courseNameOverlay.classList.remove('hidden'); });
}
if (courseNameCancel) { courseNameCancel.addEventListener('click', () => { courseNameOverlay.classList.add('hidden'); document.body.classList.remove('modal-open'); });
}
if (courseNameOk) {
  courseNameOk.addEventListener('click', async () => {
    const name = (courseNameInput.value || '').trim();
    if (!name) { courseNameInput.focus(); return; }
    courseNameOverlay.classList.add('hidden'); document.body.classList.remove('modal-open');
    await finishRoundFlow(name);
  });
}

// NYE event listeners til lodtrækning
if (lotteryPickerClose) lotteryPickerClose.addEventListener('click', closeLotteryPicker);
if (lotteryPickerOverlay) lotteryPickerOverlay.addEventListener('click', (e) => { if (e.target === lotteryPickerOverlay) closeLotteryPicker(); });
if (lotteryPickerConfirm) {
  lotteryPickerConfirm.addEventListener('click', () => {
    runLottery();
    closeLotteryPicker();
  });
}
if (lotteryResultClose) lotteryResultClose.addEventListener('click', closeLotteryResult);
if (lotteryResultOverlay) lotteryResultOverlay.addEventListener('click', (e) => { if (e.target === lotteryResultOverlay) closeLotteryResult(); });


// ---------------- Toast ----------------
let toastTimer = null;
function showToast(msg) {
  let t = document.getElementById('fgl-toast');
  if (!t) { t = document.createElement('div'); t.id = 'fgl-toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
}

// ---------------- Init ----------------
if (players.length > 0) { activePlayerId = players[0].id; }
render();
ensureFinesLoaded(MIN_REFRESH_INTERVAL_MS).then(() => { if (players.length) renderPanels(); });

window.addEventListener('online', () => {
  refreshSheetPlayersIfOnline(MIN_REFRESH_INTERVAL_MS).then(({ changed }) => { if (changed) renderPickerList(false); });
  refreshFinesIfOnline(MIN_REFRESH_INTERVAL_MS).then(({ changed }) => {
    if (changed) {
      const updated = loadFinesCache().list;
      if (updated.length) { FINES = updated; rebuildFineMap(); migratePlayersForFines(); if (players.length) renderPanels(); showToast('Bøder opdateret'); }
    }
  });
  queueDrain();
});
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'NEW_VERSION') {
      console.log('Ny version fundet – genindlæser...');
      window.location.reload();
    }
  });
}
