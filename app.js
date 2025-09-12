//.................................. app.js (REPLACE) ......................................
const STORAGE_KEY = 'fgl.players.v1';
const MAX_PLAYERS = 4;
const MIN_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 timer

// Google Sheet-konfiguration
const SHEET_ID = '113sdXTQcfODil1asdol1DCWZPcMKHQb5QTA1lj8Qn5A';
const SHEET_NAME = 'Spiller'; // samme ark som spillere
const SHEET_GID = '';         // valgfrit

// --- [NYT] Offline-cache til spillerlisten (uændret) ---
const SHEET_CACHE_KEY = 'fgl.sheet.players.v1';
const SHEET_CACHE_META_KEY = 'fgl.sheet.players.meta.v1';

// --- [NYT] Offline-cache til bødelisten (fra Google Sheet) ---
const FINES_CACHE_KEY = 'fgl.sheet.fines.v1';
const FINES_CACHE_META_KEY = 'fgl.sheet.fines.meta.v1';

// --- [NYT] Dynamiske bøder; ikke længere hårdkodet ---
let FINES = [];     // [{id, name, type, value, [source]}] fra arket
let FINE_MAP = {};  // id -> fine
function rebuildFineMap() { FINE_MAP = Object.fromEntries(FINES.map(f => [f.id, f])); }

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
//const pickerSearch = document.getElementById('pickerSearch');
const pickerList = document.getElementById('pickerList');
const pickerClose = document.getElementById('pickerClose');
const pickerConfirm = document.getElementById('pickerConfirm');

let pickerSelected = new Set(); // keys: `${faneNavn}\n${navn}`
let sheetPlayers = [];          // [{navn, faneNavn}]
let sheetLoaded = false;
let sheetLoadError = null;

// -------------------------- Utils --------------------------
function uid() { return 'p-' + Math.random().toString(36).slice(2, 9); }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function normalizeKey(s){ return (s ?? '').toString().trim().toLowerCase(); }

// Slugify med danske tegn (æ/ø/å) -> ae/oe/aa
function slugify(s) {
  return (s ?? '')
    .toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[æÆ]/g, 'ae').replace(/[øØ]/g, 'oe').replace(/[åÅ]/g, 'aa')
    .trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// FNV-1a hash (stabil)
function hashString(str) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// ------------------ Players: cache & fetch (uændret) ------------------
function loadSheetCache() {
  try {
    const list = JSON.parse(localStorage.getItem(SHEET_CACHE_KEY) ?? '[]');
    const meta = JSON.parse(localStorage.getItem(SHEET_CACHE_META_KEY) ?? '{}');
    return { list, meta };
  } catch {
    return { list: [], meta: {} };
  }
}
function saveSheetCache(list, meta = {}) {
  localStorage.setItem(SHEET_CACHE_KEY, JSON.stringify(list));
  localStorage.setItem(SHEET_CACHE_META_KEY, JSON.stringify(meta));
}
// Normaliser liste og lav stabil hash (uafhængig af rækkefølge/spaces)
function calcListHash(list) {
  const norm = list
    .map(p => ({ navn: (p.navn ?? '').trim(), faneNavn: (p.faneNavn ?? '').trim() }))
    .sort((a,b) => (a.faneNavn + a.navn).localeCompare(b.faneNavn + b.navn));
  return hashString(JSON.stringify(norm));
}

async function fetchSheetPlayersFromNetwork() {
  sheetLoadError = null;
  const base = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;
  const where = SHEET_GID ? `${base}&gid=${encodeURIComponent(SHEET_GID)}` :
                            `${base}&sheet=${encodeURIComponent(SHEET_NAME)}`;
  const url = `${where}&range=A:B&headers=1`;
  const resp = await fetch(url, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`Hentning fejlede (${resp.status})`);
  const text = await resp.text();
  const match = text.match(/setResponse\((.*)\)\s*;?\s*$/);
  if (!match) throw new Error('Kunne ikke parse gviz-svar');
  const json = JSON.parse(match[1]);
  if (!json.table) throw new Error('Ugyldigt gviz-svar (mangler table)');
  const cols = (json.table.cols ?? []).map(c => (c.label ?? '').trim().replace(/:$/, '').toLowerCase());
  let idxNavn = cols.indexOf('navn');
  let idxFane = cols.indexOf('fane navn');
  const rows = json.table.rows ?? [];
  if (idxNavn === -1 || idxFane === -1) {
    let headerRow = null;
    for (const r of rows) {
      const a = (r.c?.[0]?.v ?? '').toString().trim().toLowerCase().replace(/:$/, '');
      const b = (r.c?.[1]?.v ?? '').toString().trim().toLowerCase().replace(/:$/, '');
      if (a && b) { headerRow = r; break; }
    }
    if (headerRow) {
      const a = (headerRow.c?.[0]?.v ?? '').toString().trim().toLowerCase().replace(/:$/, '');
      const b = (headerRow.c?.[1]?.v ?? '').toString().trim().toLowerCase().replace(/:$/, '');
      if (a === 'navn') idxNavn = 0;
      if (b === 'fane navn') idxFane = 1;
    }
  }
  if (idxNavn === -1) throw new Error('Kolonnen "Navn" blev ikke fundet.');
  const result = [];
  let started = false;
  for (const r of rows) {
    if (!started) {
      const a = (r.c?.[0]?.v ?? '').toString().trim().toLowerCase().replace(/:$/, '');
      const b = (r.c?.[1]?.v ?? '').toString().trim().toLowerCase().replace(/:$/, '');
      if (a === 'navn' && b === 'fane navn') { started = true; continue; }
    }
    const c = r.c ?? [];
    const navn = (c[idxNavn]?.v ?? '').toString().trim();
    const fane = (idxFane >= 0 ? (c[idxFane]?.v ?? '') : '').toString().trim();
    if (navn) result.push({ navn, faneNavn: fane || navn });
  }
  return result;
}

async function refreshSheetPlayersIfOnline(minAgeMs = 0) {
  const { meta } = loadSheetCache();
  if (minAgeMs && meta?.updatedAt && (Date.now() - meta.updatedAt) < minAgeMs) {
    return { changed: false, reason: 'fresh-enough' };
  }
  if (!navigator.onLine) return { changed: false, reason: 'offline' };
  try {
    const fresh = await fetchSheetPlayersFromNetwork();
    const newHash = calcListHash(fresh);
    if (newHash !== meta?.hash) {
      saveSheetCache(fresh, { hash: newHash, updatedAt: Date.now() });
      sheetPlayers = fresh;
      sheetLoaded = true;
      return { changed: true };
    }
    return { changed: false, reason: 'no-change' };
  } catch (err) {
    sheetLoadError = err;
    return { changed: false, reason: 'error', error: err };
  }
}

// ------------------ Fines: cache & fetch (NY) ------------------
function loadFinesCache() {
  try {
    const list = JSON.parse(localStorage.getItem(FINES_CACHE_KEY) ?? '[]');
    const meta = JSON.parse(localStorage.getItem(FINES_CACHE_META_KEY) ?? '{}');
    return { list, meta };
  } catch {
    return { list: [], meta: {} };
  }
}
function saveFinesCache(list, meta = {}) {
  localStorage.setItem(FINES_CACHE_KEY, JSON.stringify(list));
  localStorage.setItem(FINES_CACHE_META_KEY, JSON.stringify(meta));
}
function calcFinesHash(list) {
  const norm = list.map(f => ({
    name: (f.name ?? '').trim(),
    value: Number(f.value ?? 0),
    type: (f.type ?? '').trim().toLowerCase()
  }));
  // Her bevarer vi rækkefølge (hash af sekvensen)
  return hashString(JSON.stringify(norm));
}

// Hent bøder fra fanen "Spiller" kolonner D:F (inkl. header-rækken)
async function fetchFinesFromNetwork() {
  const base = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;
  const where = SHEET_GID
    ? `${base}&gid=${encodeURIComponent(SHEET_GID)}`
    : `${base}&sheet=${encodeURIComponent(SHEET_NAME)}`;
  // A1-notation: hele kolonner D:F + headers
  const url = `${where}&range=D:F&headers=1`;

  const resp = await fetch(url, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`Bøder: hentning fejlede (${resp.status})`);

  const text = await resp.text();
  const match = text.match(/setResponse\((.*)\)\s*;?\s*$/);
  if (!match) throw new Error('Bøder: kunne ikke parse gviz-svar');
  const json = JSON.parse(match[1]);
  if (!json.table) throw new Error('Bøder: ugyldigt gviz-svar (mangler table)');

  // Normaliser labels
  const label = (s) => (s ?? '').toString().trim().replace(/:$/, '').toLowerCase();

  // Tillad både dansk og engelsk
  const isName  = (x) => ['bøde','bode','fine','name'].includes(x);
  const isValue = (x) => ['værdi','vaerdi','value','beløb','beloeb'].includes(x);
  const isType  = (x) => ['type','kategori'].includes(x);

  const cols = (json.table.cols ?? []).map(c => label(c.label));
  let idxName  = cols.findIndex(isName);
  let idxValue = cols.findIndex(isValue);
  let idxType  = cols.findIndex(isType);

  const rows = json.table.rows ?? [];

  // Fallback: brug første ikke-tomme række som header, hvis labels mangler
  if (idxName === -1 || idxValue === -1 || idxType === -1) {
    let headerRow = null;
    for (const r of rows) {
      const a = label(r.c?.[0]?.v), b = label(r.c?.[1]?.v), c = label(r.c?.[2]?.v);
      if (a && b && c) { headerRow = r; break; }
    }
    if (headerRow) {
      const a = label(headerRow.c?.[0]?.v), b = label(headerRow.c?.[1]?.v), c = label(headerRow.c?.[2]?.v);
      if (isName(a))  idxName  = 0;
      if (isValue(b)) idxValue = 1;
      if (isType(c))  idxType  = 2;
    }
  }

  if (idxName === -1)  throw new Error('Bøder: kolonnen "Bøde/fine" blev ikke fundet (i D:F).');
  if (idxValue === -1) throw new Error('Bøder: kolonnen "Værdi/value" blev ikke fundet (i D:F).');
  if (idxType === -1)  throw new Error('Bøder: kolonnen "Type" blev ikke fundet (i D:F).');

  // Slugify inkl. danske tegn
  const slugify = (s) => (s ?? '')
    .toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[æÆ]/g, 'ae').replace(/[øØ]/g, 'oe').replace(/[åÅ]/g, 'aa')
    .trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  const list = [];
  let started = false;
  for (const r of rows) {
    // spring header-rækken over, hvis den ligger i data
    if (!started) {
      const a = label(r.c?.[0]?.v), b = label(r.c?.[1]?.v), c = label(r.c?.[2]?.v);
      if (isName(a) && isValue(b) && isType(c)) { started = true; continue; }
    }
    const c = r.c ?? [];
    const name = (c[idxName]?.v ?? '').toString().trim();
    if (!name) continue; // ignorér tomme rækker
    const value = Number((c[idxValue]?.v ?? 0)) || 0;
    let type = (c[idxType]?.v ?? '').toString().trim().toLowerCase();

    const item = {
      id: slugify(name),
      name,
      value,
      type: (type === 'derived-check' ? 'derived-check' : (type === 'check' ? 'check' : 'count'))
    };

    // Særlig regel: "Alle Green Misset" følger værdien fra "Misset Green"
    if (slugify(name) === 'alle-green-misset' || item.type === 'derived-check') {
      item.type = 'derived-check';
      item.source = slugify('Misset Green'); // "misset-green"
    }

    list.push(item);
  }

  return list; // rækkefølgen bevares som i arket (D:F)
}

async function refreshFinesIfOnline(minAgeMs = 0) {
  const { meta } = loadFinesCache();
  if (minAgeMs && meta?.updatedAt && (Date.now() - meta.updatedAt) < minAgeMs) {
    return { changed: false, reason: 'fresh-enough' };
  }
  if (!navigator.onLine) return { changed: false, reason: 'offline' };
  try {
    const fresh = await fetchFinesFromNetwork();
    const newHash = calcFinesHash(fresh);
    if (newHash !== meta?.hash) {
      saveFinesCache(fresh, { hash: newHash, updatedAt: Date.now() });
      return { changed: true };
    }
    return { changed: false, reason: 'no-change' };
  } catch (err) {
    console.error(err);
    return { changed: false, reason: 'error', error: err };
  }
}

async function ensureFinesLoaded(minAgeMs = 0, showToastOnChange = true) {
  let loaded = false;
  // 1) Brug cache med det samme (hvis findes)
  const cached = loadFinesCache();
  if (cached.list && cached.list.length) {
    FINES = cached.list;
    rebuildFineMap();
    migratePlayersForFines();
    loaded = true;
  }
  // 2) Baggrundsopdatering (kun hvis online / gammel nok)
  const { changed } = await refreshFinesIfOnline(minAgeMs);
  if (changed) {
    const updated = loadFinesCache().list;
    if (updated.length) {
      FINES = updated;
      rebuildFineMap();
      migratePlayersForFines();
      if (players.length) renderPanels(); // opdater beløb hvis UI er vist
      if (showToastOnChange) showToast('Bøder opdateret');
      loaded = true;
    }
  }
  return loaded;
}

// ------------------ Persistens for spillere ------------------
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
      // Bemærk: vi udfylder manglende bødefelter i migratePlayersForFines() når FINES er klar
    });
    if (migrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    return parsed;
  } catch { return []; }
}
function savePlayers(players) { localStorage.setItem(STORAGE_KEY, JSON.stringify(players)); }

// Udfyld manglende felter til alle aktuelle bøder
function migratePlayersForFines() {
  let migrated = false;
  players.forEach(p => {
    if (!p.rows) p.rows = {};
    FINES.forEach(f => {
      if (p.rows[f.id] === undefined) {
        p.rows[f.id] = (f.type === 'count' ? 0 : false);
        migrated = true;
      }
    });
  });
  if (migrated) savePlayers(players);
}

// ------------------ Forretningslogik ------------------
function getFineValue(id) {
  return Number(FINE_MAP[id]?.value ?? 0);
}

function createEmptyRows() {
  const rows = {};
  for (const fine of FINES) rows[fine.id] = fine.type === 'count' ? 0 : false;
  return rows;
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

function addPlayer(displayName, meta = null) {
  if (!displayName || !displayName.trim()) return;
  if (players.length >= MAX_PLAYERS) { alert(`Du kan højst tilføje ${MAX_PLAYERS} spillere.`); return; }
  if (hasDuplicate(displayName, meta)) { return; } // spring stille over
  // SIKKERHED: kan ikke oprette spiller uden bøder indlæst
  if (!FINES.length) {
    alert('Bøder indlæses første gang. Prøv igen om et øjeblik (eller gå online).');
    return;
  }

  const p = { id: uid(), name: displayName.trim(), rows: createEmptyRows() };
  if (meta) p.meta = meta;
  players.push(p);
  activePlayerId = p.id;
  savePlayers(players);
  render();
}

function setActivePlayer(playerId) { activePlayerId = playerId; renderTabs(); renderPanels(); }
function removeAllPlayers() { players = []; activePlayerId = null; savePlayers(players); render(); }

// ------------------ Rendering ------------------
function render() {
  resetBtn.classList.toggle('hidden', players.length === 0);
  document.body.classList.toggle('empty-state', players.length === 0);
  renderTabs();
  renderPanels();
}

function renderTabs() {
  tabsEl.innerHTML = '';
  players.forEach(p => {
    const b = document.createElement('button');
    b.className = 'tab-btn' + (p.id === activePlayerId ? ' active' : '');
    b.textContent = p.name;
    b.addEventListener('click', () => setActivePlayer(p.id));
    tabsEl.appendChild(b);
  });
  // (Bøder-fanen er fjernet)
}

function buildTableForPlayer(p) {
  const table = document.createElement('table');
  table.className = 'table';
  const thead = document.createElement('thead');
  thead.innerHTML = `<tr><th>Bøder:</th><th class="count">Antal:</th><th class="amount">Beløb:</th></tr>`;
  table.appendChild(thead);
  const tbody = document.createElement('tbody');

  let sectionBreakInserted = false;
  FINES.forEach((fine) => {
    const tr = document.createElement('tr');
    const tdLabel = document.createElement('td');
    tdLabel.className = 'row-label';
    tdLabel.textContent = fine.name;

    const tdCount = document.createElement('td');
    tdCount.className = 'count';

    const tdAmt = document.createElement('td');
    tdAmt.className = 'amount';

    if (fine.type === 'count') {
      const wrap = document.createElement('div');
      wrap.className = 'counter';
      const minus = document.createElement('button'); minus.className = 'iconbtn minus'; minus.textContent = '−';
      const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.step = '1'; input.className = 'num'; input.value = p.rows[fine.id] ?? 0;
      const plus = document.createElement('button'); plus.className = 'iconbtn plus'; plus.textContent = '+';
      wrap.append(minus, input, plus);
      minus.addEventListener('click', () => {
        input.value = clamp(parseInt(input.value ?? '0',10)-1, 0, 9999);
        p.rows[fine.id] = Number(input.value);
        savePlayers(players); updateAmounts(table, p);
      });
      plus.addEventListener('click', () => {
        input.value = clamp(parseInt(input.value ?? '0',10)+1, 0, 9999);
        p.rows[fine.id] = Number(input.value);
        savePlayers(players); updateAmounts(table, p);
      });
      input.addEventListener('change', () => {
        input.value = clamp(parseInt(input.value ?? '0',10), 0, 9999);
        p.rows[fine.id] = Number(input.value);
        savePlayers(players); updateAmounts(table, p);
      });
      tdCount.appendChild(wrap);
    } else {
      // check / derived-check
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!p.rows[fine.id];
      cb.addEventListener('change', () => {
        p.rows[fine.id] = cb.checked;
        savePlayers(players); updateAmounts(table, p);
      });
      tdCount.appendChild(cb);
    }

    const amtInput = document.createElement('input');
    amtInput.type = 'text'; amtInput.className = 'amount-field'; amtInput.readOnly = true; amtInput.value = '0';
    amtInput.dataset.fineId = fine.id;
    tdAmt.appendChild(amtInput);

    tr.append(tdLabel, tdCount, tdAmt);
    tbody.appendChild(tr);

    // Bevar lille "sektion gap" efter hole-in-one (hvis findes)
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
  const totalInput = document.createElement('input'); totalInput.type = 'text'; totalInput.readOnly = true; totalInput.className = 'amount-field total-field'; totalInput.value = '0'; totalInput.id = 'total-for-' + p.id;
  tdTot.appendChild(totalInput);
  trTot.append(tdLbl, tdEmpty, tdTot);
  tfoot.appendChild(trTot);

  table.appendChild(tbody);
  table.appendChild(tfoot);
  updateAmounts(table, p);
  return table;
}

function renderPanels() {
  panelsEl.innerHTML = '';
  if (players.length === 0) return;
  const panel = document.createElement('section');
  panel.className = 'panel';
  const p = players.find(x => x.id === activePlayerId) ?? players[0];
  if (p) panel.appendChild(buildTableForPlayer(p));
  panelsEl.appendChild(panel);
}

function calcAmount(player, fine) {
  if (!fine) return 0;
  if (fine.type === 'count') {
    const n = Number(player.rows[fine.id] ?? 0);
    const v = getFineValue(fine.id);
    return n * v;
  }
  if (fine.type === 'check') {
    const v = getFineValue(fine.id);
    return player.rows[fine.id] ? v : 0;
  }
  if (fine.type === 'derived-check') {
    if (!player.rows[fine.id]) return 0;
    const src = FINE_MAP[fine.source];
    return calcAmount(player, src);
  }
  return 0;
}

function updateAmounts(table, player) {
  let total = 0;
  for (const fine of FINES) {
    const amtInput = table.querySelector(`input[data-fine-id="${fine.id}"]`);
    if (!amtInput) continue;
    const amount = calcAmount(player, fine);
    amtInput.value = amount.toString();
    total += amount;
  }
  const totalInput = table.querySelector('#total-for-' + player.id);
  if (totalInput) totalInput.value = total.toString();
}

// ------------------ Picker (Tilføj spiller) ------------------
function remainingSlots(){ return Math.max(0, MAX_PLAYERS - players.length); }

function openPicker() {
  document.body.classList.add('modal-open');
  pickerOverlay.classList.remove('hidden');
  pickerSelected = new Set();
  updatePickerConfirm();

  // 1) Vis spillere fra cache straks (hvis findes)
  const cached = loadSheetCache();
  if (cached.list && cached.list.length) {
    sheetPlayers = cached.list;
    sheetLoaded = true;
    renderPickerList(false);
  } else {
    renderPickerList(true);
  }

  // 2) Trigger bøder-indlæsning/opdatering i baggrunden
  ensureFinesLoaded(0).then(() => { /* no-op */ });

  // 3) Opdater spillerlisten i baggrunden (kun hvis online/freshness)
  refreshSheetPlayersIfOnline(MIN_REFRESH_INTERVAL_MS)
    .then(() => renderPickerList(false))
    .catch(() => renderPickerList(false));
}
function closePicker() {
  pickerOverlay.classList.add('hidden');
  document.body.classList.remove('modal-open');
  pickerSelected = new Set();
}

function updatePickerConfirm(){
  const count = pickerSelected.size;
  pickerConfirm.textContent = count>0 ? `OK (${count})` : 'OK';
  pickerConfirm.disabled = count === 0 || remainingSlots() === 0;
}

function renderPickerList(isLoading = false) {
  pickerList.innerHTML = '';
  if (isLoading) {
    pickerList.innerHTML = `<div class="picker-item"><span class="primary-label">Indlæser spillere…</span></div>`;
    return;
  }
  if (sheetLoadError) {
    pickerList.innerHTML = `<div class="picker-item"><span class="primary-label">Kunne ikke hente fra arket: ${sheetLoadError.message}</span></div>`;
    return;
  }
  const { meta } = loadSheetCache();
  if (meta.updatedAt) {
    const info = document.createElement('div');
    info.className = 'picker-item';
    info.style.opacity = '0.7';
    const ts = new Date(meta.updatedAt).toLocaleString('da-DK');
    info.innerHTML = `<span class="primary-label">Sidst opdateret: ${ts}</span>`;
    pickerList.appendChild(info);
  }
  const items = sheetPlayers;
  if (items.length === 0) {
    const hasCache = (loadSheetCache().list ?? []).length > 0;
    const msg = !hasCache && !navigator.onLine
      ? 'Ingen cache tilgængelig – gå online første gang for at hente spillerlisten.'
      : 'Ingen matches';
    pickerList.innerHTML = `<div class="picker-item"><span class="primary-label">${msg}</span></div>`;
    return;
  }
  const existingKeys = new Set([
    ...players.map(p => (p.name ?? '').toLowerCase()),
    ...players.map(p => ((p.meta?.navn) ?? '').toLowerCase())
  ]);
  const frag = document.createDocumentFragment();
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'picker-item';
    row.setAttribute('role', 'option');

    const left = document.createElement('div');
    const primary = document.createElement('div'); primary.className = 'primary-label'; primary.textContent = item.navn;
    left.append(primary);

    const key = `${item.faneNavn}\n${item.navn}`;
    const exists = existingKeys.has((item.faneNavn ?? '').toLowerCase()) ||
                   existingKeys.has((item.navn ?? '').toLowerCase());

    const right = document.createElement('div');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'selbox';
    cb.checked = pickerSelected.has(key);
    cb.disabled = exists || ((remainingSlots() - (pickerSelected.has(key) ? (pickerSelected.size-1) : pickerSelected.size)) <= 0);

    function toggle(){
      if (exists) return;
      const selectedAlready = pickerSelected.has(key);
      if (!selectedAlready && pickerSelected.size >= remainingSlots()) { return; }
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

// Confirm-knap — gør asynkron for at sikre bøder er klar
pickerConfirm.addEventListener('click', async () => {
  // Sørg for at bøder er indlæst (første gang)
  await ensureFinesLoaded(0, false);
  if (!FINES.length) {
    alert('Bøder kunne ikke hentes første gang. Gå online og prøv igen.');
    return;
  }

  const selectedKeys = Array.from(pickerSelected);
  if (selectedKeys.length === 0) return;
  const items = sheetPlayers;
  let slots = remainingSlots();
  for (const it of items) {
    const key = `${it.faneNavn}\n${it.navn}`;
    if (!selectedKeys.includes(key)) continue;
    if (slots <= 0) break;
    const display = it.faneNavn || it.navn;
    if (!hasDuplicate(display, { navn: it.navn })) {
      addPlayer(display, { navn: it.navn });
      slots--;
    }
  }
  closePicker();
});

// ------------------ Reset-dialog ------------------
addBtn.addEventListener('click', openPicker);
pickerClose.addEventListener('click', closePicker);
pickerOverlay.addEventListener('click', (e) => { if (e.target === pickerOverlay) closePicker(); });

resetBtn.addEventListener('click', () => { document.body.classList.add('modal-open'); overlay.classList.remove('hidden'); });
confirmNo.addEventListener('click', () => { overlay.classList.add('hidden'); document.body.classList.remove('modal-open'); });
confirmYes.addEventListener('click', () => {
  overlay.classList.add('hidden'); document.body.classList.remove('modal-open');
  localStorage.removeItem(STORAGE_KEY);
  removeAllPlayers();
});

// ------------------ Toast (lille popup i 2 sek.) ------------------
let toastTimer = null;
function showToast(msg) {
  let t = document.getElementById('fgl-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'fgl-toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
}

// ------------------ Init ------------------
if (players.length > 0) { activePlayerId = players[0].id; }
render();

// Når vi kommer online, prøv at opdatere både spillere og bøder
window.addEventListener('online', () => {
  refreshSheetPlayersIfOnline(MIN_REFRESH_INTERVAL_MS).then(({ changed }) => {
    if (changed) renderPickerList(false);
  });
  refreshFinesIfOnline(MIN_REFRESH_INTERVAL_MS).then(({ changed }) => {
    if (changed) {
      const updated = loadFinesCache().list;
      if (updated.length) {
        FINES = updated; rebuildFineMap(); migratePlayersForFines();
        if (players.length) renderPanels();
        showToast('Bøder opdateret');
      }
    }
  });
});


if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'NEW_VERSION') {
      console.log('Ny version fundet – genindlæser...');
      window.location.reload();
    }
  });
}
