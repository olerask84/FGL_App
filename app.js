//.................................. app.js (multi-select picker) ......................................
const STORAGE_KEY = 'fgl.players.v1';
const FINES_VALUES_KEY = 'fgl.finevalues.v1';
const MAX_PLAYERS = 4;

// Google Sheet-konfiguration
const SHEET_ID = '113sdXTQcfODil1asdol1DCWZPcMKHQb5QTA1lj8Qn5A';
const SHEET_NAME = 'Spiller'; // fanen med kolonnerne "Navn" og "Fane Navn"
const SHEET_GID = '';

const FINES = [
  { id: '3-putt', name: '3-putt', type: 'count', value: 10 },
  { id: 'streg', name: 'Streg', type: 'count', value: 10 },
  { id: 'mistet-bold', name: 'Mistet Bold', type: 'count', value: 5 },
  { id: 'misset-green', name: 'Misset Green', type: 'count', value: 5 },
  { id: 'alle-green-misset', name: 'Alle Green Misset', type: 'derived-check', source: 'misset-green' },
  { id: 'put-i-posen', name: 'Put i Posen', type: 'count', value: 10 },
  { id: 'bunker-x2', name: 'Bunker x2', type: 'count', value: 5 },
  { id: 'chip-in', name: 'Chip In', type: 'count', value: 10 },
  { id: 'luftslag', name: 'Luftslag', type: 'count', value: 25 },
  { id: 'birdie', name: 'Birdie', type: 'count', value: 10 },
  { id: 'eagle', name: 'Eagle', type: 'count', value: 100 },
  { id: 'hole-in-one', name: 'Hole in One', type: 'count', value: 200 },
  { id: 'roed-tee', name: 'Rød Tee', type: 'check', value: 50 },
  { id: 'under-25-point', name: 'Under 25 point', type: 'check', value: 25 },
  { id: 'dameoel', name: 'Dameøl', type: 'count', value: 50 },
  { id: 'buggy', name: 'Buggy', type: 'check', value: 100 },
  { id: 'dresscode', name: 'Dresscode', type: 'check', value: 50 },
  { id: 'usportslig', name: 'Usportslig', type: 'count', value: 25 },
  { id: 'brok', name: 'Brok', type: 'count', value: 25 },
  { id: 'forkert-scorekort', name: 'Forkert Scorekort', type: 'check', value: 25 },
  { id: 'tabt-ting', name: 'Tabt Ting', type: 'count', value: 25 },
  { id: 'mobiltelefoni', name: 'Mobiltelefoni', type: 'count', value: 25 },
  { id: 'glemt-ting', name: 'Glemt Ting', type: 'count', value: 25 },
  { id: 'kommer-for-sent', name: 'Komme for sent', type: 'count', value: 5 },
];

const DEFAULT_FINE_VALUES = Object.fromEntries(FINES.map(f => [f.id, f.value]));
const FINE_MAP = Object.fromEntries(FINES.map(f => [f.id, f]));

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
      FINES.forEach(f => { if (p.rows[f.id] === undefined) p.rows[f.id] = (f.type==='count'?0:false); });
    });
    if (migrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    return parsed;
  } catch { return []; }
}
function savePlayers(players) { localStorage.setItem(STORAGE_KEY, JSON.stringify(players)); }

function loadFineValues() {
  try {
    const raw = localStorage.getItem(FINES_VALUES_KEY);
    if (!raw) return { ...DEFAULT_FINE_VALUES };
    const obj = JSON.parse(raw);
    for (const id in DEFAULT_FINE_VALUES) {
      if (obj[id] == null) obj[id] = DEFAULT_FINE_VALUES[id];
    }
    return obj;
  } catch { return { ...DEFAULT_FINE_VALUES }; }
}
function saveFineValues(values) { localStorage.setItem(FINES_VALUES_KEY, JSON.stringify(values)); }

let players = loadPlayers();
let fineValues = loadFineValues();
let activePlayerId = players[0]?.id ?? null;
let activeView = 'player';
let sheetPlayers = []; // [{navn, faneNavn}]
let sheetLoaded = false;
let sheetLoadError = null;

const tabsEl = document.getElementById('tabs');
const panelsEl = document.getElementById('tabPanels');
const addBtn = document.getElementById('addPlayerBtn');
const resetBtn = document.getElementById('resetBtn');
const overlay = document.getElementById('confirmOverlay');
const confirmYes = document.getElementById('confirmYes');
const confirmNo = document.getElementById('confirmNo');
const pickerOverlay = document.getElementById('pickerOverlay');
const pickerSearch = document.getElementById('pickerSearch');
const pickerList = document.getElementById('pickerList');
const pickerClose = document.getElementById('pickerClose');
const pickerConfirm = document.getElementById('pickerConfirm');

let pickerSelected = new Set(); // keys: `${faneNavn}||${navn}`

function uid() { return 'p-' + Math.random().toString(36).slice(2, 9); }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function getFineValue(id) { return Number(fineValues[id] ?? DEFAULT_FINE_VALUES[id] ?? 0); }
function createEmptyRows() {
  const rows = {};
  for (const fine of FINES) rows[fine.id] = fine.type === 'count' ? 0 : false;
  return rows;
}
function normalizeKey(s){ return (s||'').toString().trim().toLowerCase(); }

async function fetchSheetPlayers() {
  sheetLoadError = null;
  const base = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;
  const where = SHEET_GID ? `${base}&gid=${encodeURIComponent(SHEET_GID)}` : `${base}&sheet=${encodeURIComponent(SHEET_NAME)}`;
  // vigtig: headers=1
  const url = `${where}&range=A:B&headers=1`;
  const resp = await fetch(url, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`Hentning fejlede (${resp.status})`);
  const text = await resp.text();
  const match = text.match(/setResponse\((.*)\)\s*;?\s*$/);
  if (!match) throw new Error('Kunne ikke parse gviz-svar');
  const json = JSON.parse(match[1]);
  if (!json.table) throw new Error('Ugyldigt gviz-svar (mangler table)');
  // 1) forsøg via kolonne-labels
  const cols = (json.table.cols || []).map(c => (c.label||'').trim().replace(/:$/, '').toLowerCase());
  let idxNavn = cols.indexOf('navn');
  let idxFane = cols.indexOf('fane navn');
  const rows = json.table.rows || [];
  // 2) fallback: brug første ikke-tomme række som header hvis labels mangler
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
  // "Fane Navn" er valgfri – vi falder tilbage til Navn
  const result = [];
  let started = false;
  for (const r of rows) {
    // spring header-rækken over (hvis vi brugte fallback)
    if (!started) {
      const a = (r.c?.[0]?.v ?? '').toString().trim().toLowerCase().replace(/:$/, '');
      const b = (r.c?.[1]?.v ?? '').toString().trim().toLowerCase().replace(/:$/, '');
      if (a === 'navn' || b === 'fane navn') { started = true; continue; }
    }
    const c = r.c || [];
    const navn = (c[idxNavn]?.v ?? '').toString().trim();
    const fane = (idxFane >= 0 ? (c[idxFane]?.v ?? '') : '').toString().trim();
    if (navn) result.push({ navn, faneNavn: fane || navn });
  }
  sheetPlayers = result;
  sheetLoaded = true;
}

function hasDuplicate(displayName, meta){
  const key = normalizeKey(displayName);
  if (players.some(p => normalizeKey(p.name) === key)) return true;
  if (meta?.navn){
    const nkey = normalizeKey(meta.navn);
    if (players.some(p => normalizeKey(p.meta?.navn || p.name) === nkey)) return true;
  }
  return false;
}

function addPlayer(displayName, meta = null) {
  if (!displayName || !displayName.trim()) return;
  if (players.length >= MAX_PLAYERS) { alert(`Du kan højst tilføje ${MAX_PLAYERS} spillere.`); return; }
  if (hasDuplicate(displayName, meta)) { return; } // spring stille over
  const p = { id: uid(), name: displayName.trim(), rows: createEmptyRows() };
  if (meta) p.meta = meta;
  players.push(p);
  activePlayerId = p.id;
  activeView = 'player';
  savePlayers(players);
  render();
}

function setActivePlayer(playerId) { activeView = 'player'; activePlayerId = playerId; renderTabs(); renderPanels(); }
function setActiveFines() { activeView = 'fines'; renderTabs(); renderPanels(); }
function removeAllPlayers() { players = []; activePlayerId = null; activeView = 'player'; savePlayers(players); render(); }

function render() {
  resetBtn.classList.toggle('hidden', players.length === 0);
  renderTabs();
  renderPanels();
}

function renderTabs() {
  tabsEl.innerHTML = '';
  players.forEach(p => {
    const b = document.createElement('button');
    b.className = 'tab-btn' + (activeView==='player' && p.id === activePlayerId ? ' active' : '');
    b.textContent = p.name;
    b.addEventListener('click', () => setActivePlayer(p.id));
    tabsEl.appendChild(b);
  });
  if (players.length > 0) {
    const finesTab = document.createElement('button');
    finesTab.className = 'tab-btn fines-tab' + (activeView==='fines' ? ' active' : '');
    finesTab.textContent = 'Bøder';
    finesTab.title = 'Rediger bøde-værdier';
    finesTab.addEventListener('click', setActiveFines);
    tabsEl.appendChild(finesTab);
  }
}

function renderPanels() {
  panelsEl.innerHTML = '';
  const panel = document.createElement('section');
  panel.className = 'panel';
  if (activeView === 'fines') {
    panel.appendChild(buildFinesEditor());
  } else {
    const p = players.find(x => x.id === activePlayerId) ?? players[0];
    if (p) panel.appendChild(buildTableForPlayer(p));
  }
  panelsEl.appendChild(panel);
}

function buildFinesEditor() {
  const table = document.createElement('table');
  table.className = 'table';
  const thead = document.createElement('thead');
  thead.innerHTML = `<tr><th>Bøder:</th><th class="count">Værdi:</th><th></th></tr>`;
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  FINES.forEach(fine => {
    if (fine.type === 'derived-check') return;
    const tr = document.createElement('tr');
    const tdLabel = document.createElement('td'); tdLabel.className = 'row-label'; tdLabel.textContent = fine.name;
    const tdCtrl = document.createElement('td'); tdCtrl.className = 'count';
    const tdEmpty = document.createElement('td');
    const wrap = document.createElement('div'); wrap.className = 'counter';
    const minus = document.createElement('button'); minus.className = 'iconbtn minus'; minus.textContent = '−';
    const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.step = '1'; input.className = 'num'; input.value = getFineValue(fine.id);
    const plus = document.createElement('button'); plus.className = 'iconbtn plus'; plus.textContent = '+';
    wrap.append(minus, input, plus);
    function commit(newVal){
      const v = clamp(parseInt(newVal ?? '0',10), 0, 100000);
      fineValues[fine.id] = v;
      input.value = v;
      saveFineValues(fineValues);
      if (activeView === 'player') renderPanels();
    }
    minus.addEventListener('click', () => commit((parseInt(input.value ?? '0',10))-1));
    plus.addEventListener('click', () => commit((parseInt(input.value ?? '0',10))+1));
    input.addEventListener('change', () => commit(input.value));
    tdCtrl.appendChild(wrap);
    tr.append(tdLabel, tdCtrl, tdEmpty);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
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

function openPicker() {
  document.body.classList.add('modal-open');
  pickerOverlay.classList.remove('hidden');
  pickerSelected = new Set();
  updatePickerConfirm();
  if (!sheetLoaded && !sheetLoadError) {
    renderPickerList(true);
    fetchSheetPlayers().then(() => {
      renderPickerList();
    }).catch(err => {
      sheetLoadError = err;
      console.error(err);
      renderPickerList();
    });
  } else {
    renderPickerList();
  }
}
function closePicker() {
  pickerOverlay.classList.add('hidden');
  document.body.classList.remove('modal-open');
  pickerSearch.value = '';
  pickerSelected = new Set();
}

function remainingSlots(){ return Math.max(0, MAX_PLAYERS - players.length); }

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
  const q = pickerSearch.value.trim().toLowerCase();
  const items = sheetPlayers.filter(p => p.navn.toLowerCase().includes(q) || p.faneNavn.toLowerCase().includes(q));
  if (items.length === 0) {
    pickerList.innerHTML = `<div class="picker-item"><span class="primary-label">Ingen matches</span></div>`;
    return;
  }
  const existingKeys = new Set([
    ...players.map(p => (p.name || '').toLowerCase()),
    ...players.map(p => ((p.meta?.navn) || '').toLowerCase())
  ]);
  const frag = document.createDocumentFragment();

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'picker-item';
    row.setAttribute('role', 'option');

    const left = document.createElement('div');
    const primary = document.createElement('div'); primary.className = 'primary-label'; primary.textContent = item.navn; // **fjerner visning af fane-navn**
    left.append(primary);

    const key = `${item.faneNavn}||${item.navn}`;
    const exists = existingKeys.has((item.faneNavn || '').toLowerCase()) || existingKeys.has((item.navn || '').toLowerCase());

    const right = document.createElement('div');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'selbox';
    cb.checked = pickerSelected.has(key);
    cb.disabled = exists || (remainingSlots() - (pickerSelected.has(key)? (pickerSelected.size-1) : pickerSelected.size)) <= 0;

    function toggle(){
      if (exists) return;
      // kapacitets-tjek
      const selectedAlready = pickerSelected.has(key);
      if (!selectedAlready && pickerSelected.size >= remainingSlots()) {
        return; // ingen pladser
      }
      if (selectedAlready) pickerSelected.delete(key); else pickerSelected.add(key);
      cb.checked = pickerSelected.has(key);
      updatePickerConfirm();
      // re-render for at opdatere disabled-state på andre checkbokse
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

addBtn.addEventListener('click', openPicker);
pickerClose.addEventListener('click', closePicker);
pickerOverlay.addEventListener('click', (e) => {
  if (e.target === pickerOverlay) closePicker();
});
pickerSearch.addEventListener('input', () => renderPickerList());

pickerConfirm.addEventListener('click', () => {
  const selectedKeys = Array.from(pickerSelected);
  if (selectedKeys.length === 0) return;
  // tilføj i den rækkefølge de vises i den aktuelle filtrerede liste
  const q = pickerSearch.value.trim().toLowerCase();
  const items = sheetPlayers.filter(p => p.navn.toLowerCase().includes(q) || p.faneNavn.toLowerCase().includes(q));
  let slots = remainingSlots();
  for (const it of items) {
    const key = `${it.faneNavn}||${it.navn}`;
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

resetBtn.addEventListener('click', () => { document.body.classList.add('modal-open'); overlay.classList.remove('hidden'); });
confirmNo.addEventListener('click', () => { overlay.classList.add('hidden'); document.body.classList.remove('modal-open'); });
confirmYes.addEventListener('click', () => {
  overlay.classList.add('hidden'); document.body.classList.remove('modal-open');
  localStorage.removeItem(STORAGE_KEY);
  removeAllPlayers();
});

if (players.length > 0) { activePlayerId = players[0].id; }
render();
