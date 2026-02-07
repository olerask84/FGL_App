================================================================================
RETTET app.js FIL - ALLE 3 PROBLEMER LØST
================================================================================

RETTELSER:
1. ✅ Menu-knappen forsvinder nu når man har valgt spillere
2. ✅ Enter-tasten hopper nu til samme hul hos næste spiller (skifter også til Score-fanen automatisk)
3. ✅ "Tættest pinnen" overskriften står nu OVER checkboxen ved hul 1 (ikke til venstre)

Kopier alt indholdet nedenfor og erstat din app.js fil med det.

================================================================================


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
  for (const r of rows) {
    const navn = (r.c?.[idxNavn]?.v ?? '').toString().trim();
    const faneNavn = (r.c?.[idxFane]?.v ?? '').toString().trim();
    if (!navn || !faneNavn) continue;
    result.push({ navn, faneNavn });
  }
  return result;
}

async function refreshSheetPlayersIfOnline(minInterval = 0, manualRefresh = false){
  const now = Date.now();
  const { list: cached, meta } = loadSheetCache();
  const lastFetch = Number(meta.lastFetch ?? 0);
  if (!manualRefresh && (now - lastFetch < minInterval) && cached.length) {
    return { changed: false, list: cached };
  }
  const fetched = await fetchSheetPlayersFromNetwork();
  const oldHash = meta.hash ?? '';
  const newHash = calcListHash(fetched);
  const changed = (oldHash !== newHash);
  saveSheetCache(fetched, { lastFetch: now, hash: newHash });
  return { changed, list: fetched };
}

async function ensureSheetPlayersLoaded(minInterval){
  const { list, meta } = loadSheetCache();
  const lastFetch = Number(meta.lastFetch ?? 0);
  const now = Date.now();
  if ((now - lastFetch < minInterval) && list.length) {
    sheetPlayers = list;
    sheetLoaded = true;
    return;
  }
  try { const { list: newList } = await refreshSheetPlayersIfOnline(minInterval);
    sheetPlayers = newList;
    sheetLoaded = true;
  } catch (err) {
    sheetLoadError = err;
    sheetPlayers = list.length ? list : [];
    sheetLoaded = false;
  }
}

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

async function fetchFinesFromNetwork(){
  const base = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;
  const url = `${base}&sheet=Boder&range=A:C&headers=1`;
  const resp = await fetch(url, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`Bøder hentning fejlede (${resp.status})`);
  const text = await resp.text();
  const json = parseGViz(text);
  if (!json.table) throw new Error('Ugyldigt gviz-svar (mangler table)');
  const label = s => (s ?? '').toString().trim().toLowerCase();
  const cols = (json.table.cols ?? []).map(c => label(c.label));
  const idxNavn = cols.indexOf('navn');
  const idxType = cols.indexOf('type');
  const idxValue = cols.indexOf('værdi');
  const rows = json.table.rows ?? [];
  if (idxNavn === -1 || idxType === -1 || idxValue === -1) {
    throw new Error('Kolonner i Boder-ark er ikke korrekte (navn, type, værdi)');
  }
  const arr = [];
  for (const r of rows) {
    const name = (r.c?.[idxNavn]?.v ?? '').toString().trim();
    const type = (r.c?.[idxType]?.v ?? '').toString().trim().toLowerCase();
    let val = r.c?.[idxValue]?.v ?? '';
    if (typeof val === 'number') val = val.toString();
    val = val.toString().trim();
    if (!name || !type) continue;
    const id = slugify(name);
    const typeNorm = type.startsWith('afkryds') ? 'check' : type === 'antal' ? 'count' : 'count';
    let numVal = parseInt(val, 10);
    if (isNaN(numVal)) numVal = (typeNorm === 'check') ? 10 : 0;
    if (typeNorm === 'check' && numVal === 0) numVal = 10;
    arr.push({ id, name, type: typeNorm, value: numVal });
  }
  return arr;
}

async function refreshFinesIfOnline(minInterval = 0, manualRefresh = false){
  const now = Date.now();
  const { list: cached, meta } = loadFinesCache();
  const lastFetch = Number(meta.lastFetch ?? 0);
  if (!manualRefresh && (now - lastFetch < minInterval) && cached.length) {
    return { changed: false, list: cached };
  }
  const fetched = await fetchFinesFromNetwork();
  const oldHash = hashString(JSON.stringify(cached.map(f => f.id + f.name + f.type + f.value)));
  const newHash = hashString(JSON.stringify(fetched.map(f => f.id + f.name + f.type + f.value)));
  const changed = (oldHash !== newHash);
  saveFinesCache(fetched, { lastFetch: now, hash: newHash });
  return { changed, list: fetched };
}

async function ensureFinesLoaded(minInterval, manualRefresh = false){
  const { list, meta } = loadFinesCache();
  const lastFetch = Number(meta.lastFetch ?? 0);
  const now = Date.now();
  if (!manualRefresh && (now - lastFetch < minInterval) && list.length) {
    FINES = list;
    rebuildFineMap();
    return;
  }
  try {
    const { list: newList } = await refreshFinesIfOnline(minInterval, manualRefresh);
    FINES = newList;
    rebuildFineMap();
  } catch (err) {
    if (list.length) { FINES = list; rebuildFineMap(); }
  }
}

// ---------------- Player storage ----------------
function loadPlayers(){
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); }
  catch { return []; }
}
function savePlayers(arr){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
}

function migratePlayersForFines(){
  let changed = false;
  for (const player of players) {
    if (!player.fines) { player.fines = {}; changed = true; }
    const missing = FINES.filter(fine => !(fine.id in player.fines));
    if (!missing.length) continue;
    for (const f of missing) {
      if (f.type === 'check') {
        player.fines[f.id] = { checked: false, value: f.value };
      } else {
        player.fines[f.id] = { count: 0 };
      }
    }
    changed = true;
  }
  if (changed) savePlayers(players);
}

// ---------------- Faner + paneler ----------------
function render(){
  if (!players.length) {
    tabsEl.innerHTML = '';
    panelsEl.innerHTML = '';
    addBtn.classList.remove('hidden');
    resetBtn.classList.add('hidden');
    endRoundBtn.classList.add('hidden');
    document.body.classList.add('empty-state');
    if (menuBtn) menuBtn.classList.remove('hidden');
  } else {
    document.body.classList.remove('empty-state');
    addBtn.classList.remove('hidden');
    resetBtn.classList.remove('hidden');
    endRoundBtn.classList.remove('hidden');
    if (menuBtn) menuBtn.classList.add('hidden');
    renderTabs();
    renderPanels();
  }
}

function renderTabs(){
  tabsEl.innerHTML = '';
  players.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'tab-btn';
    btn.textContent = p.name;
    if (p.id === activePlayerId) btn.classList.add('active');
    btn.addEventListener('click', () => {
      activePlayerId = p.id;
      renderTabs();
      renderPanels();
    });
    tabsEl.appendChild(btn);
  });
}

function addPlayer(name){
  const id = uid();
  const fines = {};
  for (const f of FINES) {
    if (f.type === 'check') {
      fines[f.id] = { checked: false, value: f.value };
    } else {
      fines[f.id] = { count: 0 };
    }
  }
  
  // Initialiser score med closestToPin array for 18 huller
  const newPlayer = { 
    id, 
    name, 
    fines, 
    score: { 
      holes: Array(18).fill(0), 
      hcp: 0, 
      hcpOut: 0, 
      hcpIn: 0,
      closestToPin: Array(18).fill(false) // Ny property til tættest pinnen
    } 
  };
  
  players.push(newPlayer);
  savePlayers(players);
  activePlayerId = id;
}

function removeAllPlayers(){
  players = [];
  activePlayerId = null;
  savePlayers(players);
  render();
}

function buildTableForPlayer(player){
  const tbl = document.createElement('table');
  tbl.className = 'table';
  const thead = document.createElement('thead');
  const tbody = document.createElement('tbody');
  const tfoot = document.createElement('tfoot');
  tbl.append(thead, tbody, tfoot);
  const header = document.createElement('tr');
  const c1 = document.createElement('th');
  c1.textContent = 'Bøde';
  const c2 = document.createElement('th');
  c2.className = 'amount';
  c2.textContent = 'Beløb';
  const c3 = document.createElement('th');
  c3.className = 'count';
  c3.textContent = 'Værdi';
  header.append(c1, c2, c3);
  thead.appendChild(header);
  const grouped = {};
  for (const fine of FINES) {
    const isDerived = (fine.type === 'derived-check');
    const srcId = isDerived ? (fine.source ?? '') : null;
    if (srcId) {
      if (!grouped[srcId]) grouped[srcId] = { main: null, derived: [] };
      grouped[srcId].derived.push(fine);
    } else {
      if (!grouped[fine.id]) grouped[fine.id] = { main: null, derived: [] };
      grouped[fine.id].main = fine;
    }
  }
  for (const gid in grouped) {
    const grp = grouped[gid];
    const mainFine = grp.main;
    if (!mainFine) continue;
    const entry = player.fines?.[mainFine.id];
    if (!entry) continue;
    const row = document.createElement('tr');
    const cellName = document.createElement('td');
    cellName.className = 'row-label';
    cellName.textContent = mainFine.name;
    const cellAmount = document.createElement('td');
    cellAmount.className = 'amount';
    let total = 0;
    if (mainFine.type === 'check') {
      total = entry.checked ? (entry.value ?? mainFine.value) : 0;
      cellAmount.textContent = `${total} kr`;
    } else {
      total = (entry.count ?? 0) * mainFine.value;
      cellAmount.textContent = `${total} kr`;
    }
    for (const df of grp.derived) {
      const entryD = player.fines?.[df.id];
      if (!entryD) continue;
      if (df.type === 'derived-check' && entryD.checked) {
        total += (entryD.value ?? df.value);
      }
    }
    if (grp.derived.length && mainFine.type === 'check') {
      cellAmount.textContent = `${total} kr`;
    }
    const cellVal = document.createElement('td');
    cellVal.className = 'count';
    if (mainFine.type === 'check') {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'selbox';
      cb.checked = entry.checked ?? false;
      cb.addEventListener('change', () => {
        entry.checked = cb.checked;
        savePlayers(players);
        renderPanels();
      });
      cellVal.appendChild(cb);
      for (const df of grp.derived) {
        if (df.type !== 'derived-check') continue;
        const entryD = player.fines?.[df.id];
        if (!entryD) continue;
        const derived = document.createElement('div');
        derived.style.marginTop = '.25rem';
        const dcb = document.createElement('input');
        dcb.type = 'checkbox';
        dcb.className = 'selbox';
        dcb.checked = entryD.checked ?? false;
        dcb.disabled = !entry.checked;
        dcb.addEventListener('change', () => {
          entryD.checked = dcb.checked;
          savePlayers(players);
          renderPanels();
        });
        const dlbl = document.createElement('label');
        dlbl.textContent = ` ${df.name}`;
        dlbl.style.marginLeft = '.2rem';
        dlbl.style.fontSize = '.85rem';
        derived.append(dcb, dlbl);
        cellVal.appendChild(derived);
      }
    } else {
      const counter = document.createElement('div');
      counter.className = 'counter';
      const minus = document.createElement('button');
      minus.className = 'iconbtn minus';
      minus.textContent = '−';
      minus.type = 'button';
      const num = document.createElement('div');
      num.className = 'num';
      num.textContent = (entry.count ?? 0).toString();
      const plus = document.createElement('button');
      plus.className = 'iconbtn';
      plus.textContent = '+';
      plus.type = 'button';
      minus.addEventListener('click', () => {
        entry.count = clamp((entry.count ?? 0) - 1, 0, 999);
        savePlayers(players);
        renderPanels();
      });
      plus.addEventListener('click', () => {
        entry.count = clamp((entry.count ?? 0) + 1, 0, 999);
        savePlayers(players);
        renderPanels();
      });
      counter.append(minus, num, plus);
      cellVal.appendChild(counter);
    }
    row.append(cellName, cellAmount, cellVal);
    tbody.appendChild(row);
  }
  const footRow = document.createElement('tr');
  const sumLabel = document.createElement('td');
  sumLabel.textContent = 'I alt';
  const sumVal = document.createElement('td');
  sumVal.colSpan = 2;
  let grandTotal = 0;
  for (const fine of FINES) {
    const entry = player.fines?.[fine.id];
    if (!entry) continue;
    if (fine.type === 'check' || fine.type === 'derived-check') {
      if (entry.checked) {
        grandTotal += (entry.value ?? fine.value);
      }
    } else {
      grandTotal += (entry.count ?? 0) * fine.value;
    }
  }
  sumVal.textContent = `${grandTotal} kr`;
  footRow.append(sumLabel, sumVal);
  tfoot.appendChild(footRow);
  return tbl;
}

function renderScoreCard(player) {
  // Sikr at alle score-felter findes
  if (!player.score) {
    player.score = { 
      holes: Array(18).fill(0), 
      hcp: 0, 
      hcpOut: 0, 
      hcpIn: 0,
      closestToPin: Array(18).fill(false)
    };
  }
  if (!player.score.holes) player.score.holes = Array(18).fill(0);
  if (player.score.hcp === undefined) player.score.hcp = 0;
  if (player.score.hcpOut === undefined) player.score.hcpOut = 0;
  if (player.score.hcpIn === undefined) player.score.hcpIn = 0;
  if (!player.score.closestToPin) player.score.closestToPin = Array(18).fill(false);

  // Hop til samme hul hos næste spiller
  function focusSameHoleOnNextPlayer(currentPlayerId, holeIndex) {
    const curIdx = players.findIndex(p => p.id === currentPlayerId);
    if (curIdx === -1) return;
    const nextPlayer = players[(curIdx + 1) % players.length];
    
    // Skift aktiv spiller i UI
    activePlayerId = nextPlayer.id;
    renderTabs();
    renderPanels();
    
    // Giv panelet tid til at tegne
    setTimeout(() => {
      // 1) Skift aktiv subtab til "Score"
      const scoreBtn = document.querySelector('.subtabs .subtab:nth-child(2)');
      if (scoreBtn) {
        scoreBtn.click(); // aktiver "Score"-fanen for den nye spiller
      }
      
      // 2) Find samme hul (1..18) og fokuser
      const nextHoleInput = document.querySelector(
        `.score-row:nth-child(${holeIndex + 1}) input`
      );
      if (nextHoleInput) {
        nextHoleInput.focus();
        nextHoleInput.select?.();
      }
    }, 30);
  }
  
  const wrap = document.createElement('div');
  wrap.className = 'scorecard';

  // Hjælpefunktion til at lave en score-row med checkbox
  function createHoleRow(holeNum, holeIndex) {
    const row = document.createElement('div');
    row.className = 'score-row';

    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = `Hul ${holeNum}`;

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.inputMode = 'numeric';
    inp.pattern = '[0-9]*';
    inp.enterKeyHint = 'Done';
    inp.min = 0;
    inp.value = player.score.holes[holeIndex] ? player.score.holes[holeIndex] : "";
    inp.setAttribute('data-player-id', player.id);
    inp.setAttribute('data-hole', holeIndex);
    
    inp.addEventListener('change', () => {
      player.score.holes[holeIndex] = Number(inp.value || 0);
      savePlayers(players);
      updateScoreTotals();
    });

    inp.addEventListener("beforeinput", (e) => {
      if (
        e.inputType === "insertLineBreak" ||
        e.inputType === "insertParagraph" ||
        (e.inputType.startsWith("insert") && e.data === null)
      ) {
        e.preventDefault();
        focusSameHoleOnNextPlayer(player.id, holeIndex);
      }
    });

    inp.addEventListener('keydown', (e) => {
      const keysThatAdvance = ['Enter', 'ArrowDown', 'Next', 'Done', 'Tab'];
      if (keysThatAdvance.includes(e.key)) { 
        e.preventDefault();
        focusSameHoleOnNextPlayer(player.id, holeIndex);
      }
    });

    // Checkbox for "Tættest pinnen"
    const checkboxWrap = document.createElement('div');
    checkboxWrap.style.display = 'flex';
    checkboxWrap.style.flexDirection = 'column';
    checkboxWrap.style.alignItems = 'center';
    checkboxWrap.style.gap = '0.2rem';
    
    // Vis kun label på første hul - OVER checkboxen
    if (holeIndex === 0) {
      const checkLabel = document.createElement('span');
      checkLabel.textContent = 'Tættest pinnen';
      checkLabel.style.fontSize = '0.75rem';
      checkLabel.style.color = 'var(--muted)';
      checkLabel.style.fontWeight = '600';
      checkLabel.style.whiteSpace = 'nowrap';
      checkboxWrap.appendChild(checkLabel);
    }
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'selbox';
    checkbox.checked = player.score.closestToPin[holeIndex] || false;
    checkbox.addEventListener('change', () => {
      player.score.closestToPin[holeIndex] = checkbox.checked;
      savePlayers(players);
    });
    
    checkboxWrap.appendChild(checkbox);

    row.append(label, inp, checkboxWrap);
    wrap.appendChild(row);
  }

  // Hul 1-9
  for (let i = 0; i < 9; i++) {
    createHoleRow(i + 1, i);
  }

  // Brutto ud
  const bruttoOutRow = document.createElement('div');
  bruttoOutRow.className = 'score-row';
  const bruttoOutLab = document.createElement('div');
  bruttoOutLab.className = 'label';
  bruttoOutLab.textContent = 'Brutto ud';
  const bruttoOutVal = document.createElement('input');
  bruttoOutVal.type = 'text';
  bruttoOutVal.readOnly = true;
  bruttoOutVal.id = `score-brutto-out-${player.id}`;
  bruttoOutRow.append(bruttoOutLab, bruttoOutVal);
  wrap.appendChild(bruttoOutRow);

  // Tildelte slag ud
  const hcpOutRow = document.createElement('div');
  hcpOutRow.className = 'score-row';
  const hcpOutLab = document.createElement('div');
  hcpOutLab.className = 'label';
  hcpOutLab.textContent = 'Tildelte slag ud';
  const hcpOutInput = document.createElement('input');
  hcpOutInput.type = 'number';
  hcpOutInput.min = 0;
  hcpOutInput.value = player.score?.hcpOut ? player.score?.hcpOut : "";
  hcpOutInput.addEventListener('change', () => {
    player.score.hcpOut = Number(hcpOutInput.value || 0);
    savePlayers(players);
    updateScoreTotals();
  });
  hcpOutRow.append(hcpOutLab, hcpOutInput);
  wrap.appendChild(hcpOutRow);

  // Netto ud
  const netOutRow = document.createElement('div');
  netOutRow.className = 'score-row';
  const netOutLab = document.createElement('div');
  netOutLab.className = 'label';
  netOutLab.textContent = 'Netto ud';
  const netOutVal = document.createElement('input');
  netOutVal.type = 'text';
  netOutVal.readOnly = true;
  netOutVal.id = `score-net-out-${player.id}`;
  netOutRow.append(netOutLab, netOutVal);
  wrap.appendChild(netOutRow);

  // Hul 10-18
  for (let i = 9; i < 18; i++) {
    createHoleRow(i + 1, i);
  }

  // Brutto ind
  const bruttoInRow = document.createElement('div');
  bruttoInRow.className = 'score-row';
  const bruttoInLab = document.createElement('div');
  bruttoInLab.className = 'label';
  bruttoInLab.textContent = 'Brutto ind';
  const bruttoInVal = document.createElement('input');
  bruttoInVal.type = 'text';
  bruttoInVal.readOnly = true;
  bruttoInVal.id = `score-brutto-in-${player.id}`;
  bruttoInRow.append(bruttoInLab, bruttoInVal);
  wrap.appendChild(bruttoInRow);

  // Tildelte slag ind
  const hcpInRow = document.createElement('div');
  hcpInRow.className = 'score-row';
  const hcpInLab = document.createElement('div');
  hcpInLab.className = 'label';
  hcpInLab.textContent = 'Tildelte slag ind';
  const hcpInInput = document.createElement('input');
  hcpInInput.type = 'number';
  hcpInInput.min = 0;
  hcpInInput.value = player.score?.hcpIn ? player.score?.hcpIn : "";
  hcpInInput.addEventListener('change', () => {
    player.score.hcpIn = Number(hcpInInput.value || 0);
    savePlayers(players);
    updateScoreTotals();
  });
  hcpInRow.append(hcpInLab, hcpInInput);
  wrap.appendChild(hcpInRow);

  // Netto ind
  const netInRow = document.createElement('div');
  netInRow.className = 'score-row';
  const netInLab = document.createElement('div');
  netInLab.className = 'label';
  netInLab.textContent = 'Netto ind';
  const netInVal = document.createElement('input');
  netInVal.type = 'text';
  netInVal.readOnly = true;
  netInVal.id = `score-net-in-${player.id}`;
  netInRow.append(netInLab, netInVal);
  wrap.appendChild(netInRow);

  // Brutto total
  const bruttoTotalRow = document.createElement('div');
  bruttoTotalRow.className = 'score-row';
  const bruttoTotalLab = document.createElement('div');
  bruttoTotalLab.className = 'label';
  bruttoTotalLab.textContent = 'Brutto total';
  const bruttoTotalVal = document.createElement('input');
  bruttoTotalVal.type = 'text';
  bruttoTotalVal.readOnly = true;
  bruttoTotalVal.id = `score-brutto-total-${player.id}`;
  bruttoTotalRow.append(bruttoTotalLab, bruttoTotalVal);
  wrap.appendChild(bruttoTotalRow);

  // Tildelte slag total (fjernet)
  const hcpTotalRow = document.createElement('div');
  hcpTotalRow.className = 'score-row';
  const hcpTotalLab = document.createElement('div');
  hcpTotalLab.className = 'label';
  hcpTotalLab.textContent = 'Tildelte slag total';
  const hcpTotalVal = document.createElement('input');
  hcpTotalVal.type = 'text';
  hcpTotalVal.readOnly = true;
  hcpTotalVal.id = `score-hcp-total-${player.id}`;
  hcpTotalRow.append(hcpTotalLab, hcpTotalVal);
  wrap.appendChild(hcpTotalRow);

  // Netto total
  const netTotalRow = document.createElement('div');
  netTotalRow.className = 'score-row';
  const netTotalLab = document.createElement('div');
  netTotalLab.className = 'label';
  netTotalLab.textContent = 'Netto total';
  const netTotalVal = document.createElement('input');
  netTotalVal.type = 'text';
  netTotalVal.readOnly = true;
  netTotalVal.id = `score-net-total-${player.id}`;
  netTotalRow.append(netTotalLab, netTotalVal);
  wrap.appendChild(netTotalRow);

  function updateScoreTotals() {
    // Beregn brutto ud (hul 1-9)
    const bruttoOut = player.score.holes.slice(0, 9).reduce((a, b) => a + Number(b || 0), 0);
    bruttoOutVal.value = bruttoOut > 0 ? bruttoOut : "";
    
    // Beregn brutto ind (hul 10-18)
    const bruttoIn = player.score.holes.slice(9, 18).reduce((a, b) => a + Number(b || 0), 0);
    bruttoInVal.value = bruttoIn > 0 ? bruttoIn : "";
    
    // Beregn brutto total
    const bruttoTotal = bruttoOut + bruttoIn;
    bruttoTotalVal.value = bruttoTotal > 0 ? bruttoTotal : "";
    
    // Beregn netto ud
    const hcpOut = Number(player.score?.hcpOut || 0);
    const netOut = bruttoOut - hcpOut;
    netOutVal.value = (bruttoOut > 0 || hcpOut > 0) ? netOut : "";
    
    // Beregn netto ind
    const hcpIn = Number(player.score?.hcpIn || 0);
    const netIn = bruttoIn - hcpIn;
    netInVal.value = (bruttoIn > 0 || hcpIn > 0) ? netIn : "";
    
    // Beregn tildelte slag total
    const hcpTotal = hcpOut + hcpIn;
    hcpTotalVal.value = hcpTotal > 0 ? hcpTotal : "";
    
    // Beregn netto total
    const netTotal = bruttoTotal - hcpTotal;
    netTotalVal.value = (bruttoTotal > 0 || hcpTotal > 0) ? netTotal : "";
  }

  updateScoreTotals();
  return wrap;
}

function renderPanels() {
    panelsEl.innerHTML = '';
    if (!players.length) return;

    const p = players.find(x => x.id === activePlayerId) ?? players[0];

    const panel = document.createElement('section');
    panel.className = 'panel';

    // --- SUBTABS ---
    const tabs = document.createElement('div');
    tabs.className = 'subtabs';

    const btnF = document.createElement('button');
    btnF.className = 'subtab active';
    btnF.textContent = 'Bøder';

    const btnS = document.createElement('button');
    btnS.className = 'subtab';
    btnS.textContent = 'Score';

    tabs.append(btnF, btnS);
    panel.appendChild(tabs);

    // --- CONTENT AREA ---
    const content = document.createElement('div');
    content.className = 'subcontent';
    panel.appendChild(content);

    const showFines = () => {
    btnF.classList.add('active');
    btnS.classList.remove('active');
    content.innerHTML = '';

    // Hvis bøder ikke er indlæst endnu, vis "Indlæser..." og prøv igen
    if (!Array.isArray(FINES) || FINES.length === 0) {
      const loading = document.createElement('div');
      loading.textContent = 'Indlæser bøder…';
      content.appendChild(loading);

      ensureFinesLoaded(0, false).then(() => {
        // Tegn igen, når bøderne er kommet
        content.innerHTML = '';
        content.appendChild(buildTableForPlayer(p));
      });
      return;
    }

    content.appendChild(buildTableForPlayer(p));
  };

    const showScore = () => {
        btnS.classList.add('active');
        btnF.classList.remove('active');
        content.innerHTML = '';
        content.appendChild(renderScoreCard(p));
    };

    btnF.addEventListener('click', showFines);
    btnS.addEventListener('click', showScore);

    // Standardvisning
    showFines();

    panelsEl.appendChild(panel);
}

// ---------------- Picker (spillerliste) ----------------
function openPicker(){
  document.body.classList.add('modal-open');
  pickerOverlay.classList.remove('hidden');
  renderPickerList(true);
  refreshSheetPlayersIfOnline(MIN_REFRESH_INTERVAL_MS)
    .then(({ changed, list }) => {
      sheetPlayers = list;
      sheetLoaded = true;
      renderPickerList(false);
    })
    .catch(err => {
      sheetLoadError = err;
      sheetLoaded = false;
      renderPickerList(false);
    });
}
function closePicker(){
  pickerOverlay.classList.add('hidden');
  document.body.classList.remove('modal-open');
  pickerSelected = new Set();
}
function updatePickerConfirm(){
  const count = pickerSelected.size;
  pickerConfirm.textContent = count > 0 ? `OK (${count})` : 'OK';
  pickerConfirm.disabled = (count === 0);
}
function renderPickerList(isLoading = false){
  pickerList.innerHTML = '';
  if (isLoading) {
    pickerList.innerHTML = `<div class="picker-item"><span class="primary-label">Indlæser spillere…</span></div>`;
    return;
  }
  if (sheetLoadError) {
    pickerList.innerHTML = `<div class="picker-item"><span class="primary-label">Kunne ikke hente fra arket: ${sheetLoadError.message}</span></div>`;
    return;
  }
  const items = sheetPlayers;
  if (items.length === 0){
    const hasCache = (loadSheetCache().list ?? []).length > 0;
    const msg = (!hasCache && !navigator.onLine)
      ? 'Ingen cache tilgængelig – gå online første gang for at hente spillerlisten.'
      : 'Ingen spillere fundet';
    pickerList.innerHTML = `<div class="picker-item"><span class="primary-label">${msg}</span></div>`;
    return;
  }
  const frag = document.createDocumentFragment();
  items.forEach(item => {
    const key = `${item.navn}|${item.faneNavn}`;
    if (!key) return;
    const existing = players.find(p => p.name === item.navn);
    const disabled = !!existing || (players.length >= MAX_PLAYERS && !pickerSelected.has(key));
    const row = document.createElement('div');
    row.className = 'picker-item';
    row.setAttribute('role', 'option');
    if (disabled) row.classList.add('disabled');
    const left = document.createElement('div');
    const primary = document.createElement('div');
    primary.className = 'primary-label';
    primary.textContent = item.navn;
    left.append(primary);
    const right = document.createElement('div');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'selbox';
    cb.checked = pickerSelected.has(key);
    cb.disabled = disabled && !cb.checked;
    function toggle(){
      if (cb.disabled) return;
      if (pickerSelected.has(key)) {
        pickerSelected.delete(key);
      } else {
        pickerSelected.add(key);
      }
      cb.checked = pickerSelected.has(key);
      updatePickerConfirm();
      renderPickerList(false);
    }
    row.addEventListener('click', (e) => { if (e.target !== cb) toggle(); });
    cb.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    right.appendChild(cb);
    row.append(left, right);
    frag.appendChild(row);
  });
  pickerList.appendChild(frag);
}
pickerConfirm.addEventListener('click', () => {
  if (pickerSelected.size === 0) return;
  pickerSelected.forEach(key => {
    const parts = key.split('|');
    const navn = parts[0];
    const existing = players.find(p => p.name === navn);
    if (!existing) addPlayer(navn);
  });
  closePicker();
  render();
});

// ------------------------------------------------
// Afslut runde
// ------------------------------------------------
async function finishRoundFlow(courseName){
  const roundData = { course: courseName, date: new Date().toISOString(), players: [] };
  for (const p of players){
    const bruttoOut = (p.score?.holes ?? []).slice(0,9).reduce((a,b)=>a+Number(b||0),0);
    const bruttoIn = (p.score?.holes ?? []).slice(9,18).reduce((a,b)=>a+Number(b||0),0);
    const bruttoTotal = bruttoOut + bruttoIn;
    
    const hcpOut = Number(p.score?.hcpOut || 0);
    const hcpIn = Number(p.score?.hcpIn || 0);
    const hcpTotal = hcpOut + hcpIn;
    
    const netOut = bruttoOut - hcpOut;
    const netIn = bruttoIn - hcpIn;
    const netTotal = bruttoTotal - hcpTotal;
    
    let finesTotal = 0;
    for (const fine of FINES){
      const entry = p.fines?.[fine.id];
      if (!entry) continue;
      if (fine.type === 'check' || fine.type === 'derived-check'){
        if (entry.checked) finesTotal += (entry.value ?? fine.value);
      } else {
        finesTotal += (entry.count ?? 0) * fine.value;
      }
    }
    roundData.players.push({
      name: p.name,
      bruttoOut,
      bruttoIn,
      bruttoTotal,
      hcpOut,
      hcpIn,
      hcpTotal,
      netOut,
      netIn,
      netTotal,
      finesTotal,
      holes: p.score?.holes ?? [],
      closestToPin: p.score?.closestToPin ?? []
    });
  }
  const success = await sendToBackend(roundData);
  if (success && AUTO_RESET_AFTER_SEND) {
    localStorage.removeItem(STORAGE_KEY);
    removeAllPlayers();
    showToast('Runde sendt & nulstillet!');
  } else if (success) {
    showToast('Runde sendt!');
  } else {
    showToast('Kunne ikke sende data, gemt i kø');
  }
}
async function sendToBackend(roundData){
  try {
    const resp = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: SECRET_KEY, ...roundData })
    });
    if (resp.ok) { if (ENABLE_OFFLINE_QUEUE) queueRemove(roundData); return true; }
    else throw new Error('HTTP error');
  } catch {
    if (ENABLE_OFFLINE_QUEUE) queueAdd(roundData);
    return false;
  }
}
function queueAdd(data){
  try {
    const arr = JSON.parse(localStorage.getItem(ROUND_QUEUE_KEY) ?? '[]');
    arr.push(data);
    localStorage.setItem(ROUND_QUEUE_KEY, JSON.stringify(arr));
  } catch {}
}
function queueRemove(data){
  try {
    let arr = JSON.parse(localStorage.getItem(ROUND_QUEUE_KEY) ?? '[]');
    arr = arr.filter(x => JSON.stringify(x) !== JSON.stringify(data));
    localStorage.setItem(ROUND_QUEUE_KEY, JSON.stringify(arr));
  } catch {}
}
async function queueDrain(){
  if (!ENABLE_OFFLINE_QUEUE) return;
  try {
    const arr = JSON.parse(localStorage.getItem(ROUND_QUEUE_KEY) ?? '[]');
    if (!arr.length) return;
    for (const data of arr){
      const ok = await sendToBackend(data);
      if (ok) showToast('Kødata sendt');
    }
  } catch {}
}

// ------------------------------------------------
// Menu (inkl. viewer for faner)
// ------------------------------------------------
function openMenu(){
  ensureSheetPlayersLoaded(MIN_REFRESH_INTERVAL_MS).then(() => renderMenu());
  document.body.classList.add('modal-open');
  menuOverlay.classList.remove('hidden');
}
function closeMenu(){
  menuOverlay.classList.add('hidden');
  document.body.classList.remove('modal-open');
}
function renderMenu(){
  menuList.innerHTML = '';
  const tabs = getAvailableTabsFromPlayers();
  
  // Heading: Faneoversigter
  const heading1 = document.createElement('div');
  heading1.className = 'menu-heading';
  heading1.textContent = 'Faneoversigter';
  menuList.appendChild(heading1);
  
  for (const tabName of tabs){
    const item = document.createElement('div');
    item.className = 'menu-item';
    const left = document.createElement('div');
    const nameEl = document.createElement('div');
    nameEl.className = 'name';
    nameEl.textContent = tabName;
    left.appendChild(nameEl);
    const right = document.createElement('div');
    right.textContent = '›';
    right.style.fontSize = '1.3rem';
    right.style.color = 'var(--muted)';
    item.append(left, right);
    item.addEventListener('click', () => {
      closeMenu();
      showSheetViewer(tabName);
    });
    menuList.appendChild(item);
  }
  
  // Heading: Funktioner
  const heading2 = document.createElement('div');
  heading2.className = 'menu-heading';
  heading2.textContent = 'Funktioner';
  menuList.appendChild(heading2);
  
  // Lodtrækning
  const lotteryItem = document.createElement('div');
  lotteryItem.className = 'menu-item';
  const lotteryLeft = document.createElement('div');
  const lotteryName = document.createElement('div');
  lotteryName.className = 'name';
  lotteryName.textContent = 'Lodtrækning';
  const lotteryHint = document.createElement('div');
  lotteryHint.className = 'hint';
  lotteryHint.textContent = 'Tilfældig gruppeinddeling';
  lotteryLeft.append(lotteryName, lotteryHint);
  const lotteryRight = document.createElement('div');
  lotteryRight.textContent = '›';
  lotteryRight.style.fontSize = '1.3rem';
  lotteryRight.style.color = 'var(--muted)';
  lotteryItem.append(lotteryLeft, lotteryRight);
  lotteryItem.addEventListener('click', () => {
    closeMenu();
    openLotteryPicker();
  });
  menuList.appendChild(lotteryItem);
}

function showSheetViewer(tabName){
  sheetViewerTitle.textContent = tabName;
  sheetViewer.classList.remove('hidden');
  sheetViewerContent.innerHTML = '<p>Indlæser...</p>';
  fetchSheetDataForTab(tabName)
    .then(table => {
      sheetViewerContent.innerHTML = '';
      sheetViewerContent.appendChild(table);
    })
    .catch(err => {
      sheetViewerContent.innerHTML = `<p>Fejl: ${err.message}</p>`;
    });
}
sheetBack.addEventListener('click', () => {
  sheetViewer.classList.add('hidden');
});
async function fetchSheetDataForTab(tabName){
  const base = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;
  const url = `${base}&sheet=${encodeURIComponent(tabName)}`;
  const resp = await fetch(url, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const text = await resp.text();
  const json = parseGViz(text);
  if (!json.table) throw new Error('Intet table-objekt');
  const colCount = (json.table.cols ?? []).length;
  const rows = json.table.rows ?? [];
  const table = document.createElement('table');
  const isTotal = tabName.toLowerCase() === 'total';
  if (isTotal) {
    table.className = 'sheet-table sticky-first-col sticky-top-rows';
  } else {
    table.className = 'sheet-table';
  }
  const thead = document.createElement('thead');
  const tbody = document.createElement('tbody');
  table.append(thead, tbody);
  if (rows.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.textContent = 'Ingen data fundet';
    td.colSpan = colCount;
    tr.appendChild(td);
    tbody.appendChild(tr);
    return table;
  }
  // Header-row: Row 1
  const headerRow = rows[0];
  const htr = document.createElement('tr');
  for (let c = 0; c < colCount; c++){
    const th = document.createElement('th');
    const cellVal = headerRow.c?.[c]?.v ?? '';
    th.textContent = cellVal.toString();
    htr.appendChild(th);
  }
  thead.appendChild(htr);
  // Data-rows
  for (let r = 1; r < rows.length; r++){
    const tr = document.createElement('tr');
    for (let c = 0; c < colCount; c++){
      const td = document.createElement('td');
      const cellVal = rows[r].c?.[c]?.v ?? '';
      td.textContent = cellVal.toString();
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  return table;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ------------------------------------------------
// Lodtrækning
// ------------------------------------------------
function openLotteryPicker() {
  document.body.classList.add('modal-open');
  lotteryPickerOverlay.classList.remove('hidden');
  renderLotteryPickerList(true);
  
  refreshSheetPlayersIfOnline(MIN_REFRESH_INTERVAL_MS)
    .then(({ changed, list }) => {
      sheetPlayers = list;
      sheetLoaded = true;
      renderLotteryPickerList(false);
    })
    .catch(err => {
      sheetLoadError = err;
      sheetLoaded = false;
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
