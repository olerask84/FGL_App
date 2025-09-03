const STORAGE_KEY = 'fgl.players.v1';
const FINES_VALUES_KEY = 'fgl.finevalues.v1';

// Katalog – bemærk den nye derived-check lige efter Misset Green
const FINES = [
  { id: '3-putt',          name: '3-putt',          type: 'count', value: 10 },
  { id: 'streg',           name: 'Streg',           type: 'count', value: 10 },
  { id: 'mistet-bold',     name: 'Mistet Bold',     type: 'count', value: 5 },

  { id: 'misset-green',    name: 'Misset Green',    type: 'count', value: 5 },
  // NY: afledt checkbox som arver beløb fra "misset-green" (ikke x2)
  { id: 'alle-green-misset', name: 'Alle Green Misset', type: 'derived-check', source: 'misset-green' },

  { id: 'put-i-posen',     name: 'Put i Posen',     type: 'count', value: 10 },
  { id: 'bunker-x2',       name: 'Bunker x2',       type: 'count', value: 5 },
  { id: 'chip-in',         name: 'Chip In',         type: 'count', value: 10 },
  { id: 'luftslag',        name: 'Luftslag',        type: 'count', value: 25 },
  { id: 'birdie',          name: 'Birdie',          type: 'count', value: 10 },
  { id: 'eagle',           name: 'Eagle',           type: 'count', value: 100 },
  { id: 'hole-in-one',     name: 'Hole in One',     type: 'count', value: 200 },

  // Checkboxes
  { id: 'roed-tee',        name: 'Rød Tee',         type: 'check', value: 50 },
  { id: 'under-25-point',  name: 'Under 25 point',  type: 'check', value: 25 },
  { id: 'dameoel',         name: 'Dameøl',          type: 'check', value: 50 },
  { id: 'buggy',           name: 'Buggy',           type: 'check', value: 100 },
  { id: 'dresscode',       name: 'Dresscode',       type: 'check', value: 50 },

  // Counters
  { id: 'usportslig',      name: 'Usportslig',      type: 'count', value: 25 },
  { id: 'brok',            name: 'Brok',            type: 'count', value: 25 },
  { id: 'forkert-scorekort', name: 'Forkert Scorekort', type: 'check', value: 25 },
  { id: 'tabt-ting',       name: 'Tabt Ting',       type: 'count', value: 25 },
  { id: 'mobiltelefoni',   name: 'Mobiltelefoni',   type: 'count', value: 25 },
  { id: 'glemt-ting',      name: 'Glemt Ting',      type: 'count', value: 25 },
  { id: 'kommer-for-sent', name: 'Komme for sent',  type: 'count', value: 5 },
];

const DEFAULT_FINE_VALUES = Object.fromEntries(FINES.map(f => [f.id, f.value]));
const FINE_MAP = Object.fromEntries(FINES.map(f => [f.id, f]));

/** Storage helpers **/
function loadPlayers() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Migration fra tidligere dubletter
    let migrated = false;
    parsed.forEach(p => {
      if (!p.rows) return;
      const brokSum = (p.rows['brok']||0) + (p.rows['brok-1']||0) + (p.rows['brok-2']||0);
      if (brokSum !== (p.rows['brok']||0)) { p.rows['brok'] = brokSum; migrated = true; }
      delete p.rows['brok-1']; delete p.rows['brok-2'];
      const fsSum = (p.rows['forkert-scorekort']||0) + (p.rows['forkert-scorekort-1']||0) + (p.rows['forkert-scorekort-2']||0);
      if (fsSum !== (p.rows['forkert-scorekort']||0)) { p.rows['forkert-scorekort'] = fsSum; migrated = true; }
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

/** App State **/
let players = loadPlayers();
let fineValues = loadFineValues();
let activePlayerId = players[0]?.id || null;
let activeView = 'player'; // 'player' | 'fines'

/** DOM **/
const tabsEl = document.getElementById('tabs');
const panelsEl = document.getElementById('tabPanels');
const nameInput = document.getElementById('playerName');
const addBtn = document.getElementById('addPlayerBtn');
const resetBtn = document.getElementById('resetBtn');
const overlay = document.getElementById('confirmOverlay');
const confirmYes = document.getElementById('confirmYes');
const confirmNo = document.getElementById('confirmNo');

// (valgfri) Installér-knap til Android/Chromium
//const installBtn = document.getElementById('installBtn');
//let deferredInstallEvent = null;
//window.addEventListener('beforeinstallprompt', (e) => {
//  e.preventDefault();
//  deferredInstallEvent = e;
//  installBtn.style.display = 'inline-block';
//});
//installBtn.addEventListener('click', async () => {
//  if (!deferredInstallEvent) return;
//  await deferredInstallEvent.prompt();
//  deferredInstallEvent = null;
//  installBtn.style.display = 'none';
//});
//window.addEventListener('appinstalled', () => {
//  deferredInstallEvent = null; installBtn.style.display = 'none';
//});

/** Utils **/
function uid() { return 'p-' + Math.random().toString(36).slice(2, 9); }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function getFineValue(id) { return Number(fineValues[id] ?? DEFAULT_FINE_VALUES[id] ?? 0); }

function createEmptyRows() {
  const rows = {};
  for (const fine of FINES) rows[fine.id] = fine.type === 'count' ? 0 : false;
  return rows;
}

/** Actions **/
function addPlayer(name) {
  if (!name || !name.trim()) return;
  if (players.length >= 4) { alert('Du kan højst tilføje 4 spillere.'); return; }
  const p = { id: uid(), name: name.trim(), rows: createEmptyRows() };
  players.push(p);
  activePlayerId = p.id;
  activeView = 'player';
  savePlayers(players);
  render();
}
function setActivePlayer(playerId) { activeView = 'player'; activePlayerId = playerId; renderTabs(); renderPanels(); }
function setActiveFines() { activeView = 'fines'; renderTabs(); renderPanels(); }
function removeAllPlayers() { players = []; activePlayerId = null; activeView = 'player'; savePlayers(players); render(); }

/** Render **/
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
    const p = players.find(x => x.id === activePlayerId) || players[0];
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
    if (fine.type === 'derived-check') return; // afledte rækker kan ikke sættes her

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
      const v = clamp(parseInt(newVal||'0',10), 0, 100000);
      fineValues[fine.id] = v;
      input.value = v;
      saveFineValues(fineValues);
      if (activeView === 'player') renderPanels();
    }

    minus.addEventListener('click', () => commit((parseInt(input.value||'0',10))-1));
    plus.addEventListener('click', () => commit((parseInt(input.value||'0',10))+1));
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
      const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.step = '1'; input.className = 'num'; input.value = p.rows[fine.id] || 0;
      const plus = document.createElement('button'); plus.className = 'iconbtn plus'; plus.textContent = '+';
      wrap.append(minus, input, plus);

      minus.addEventListener('click', () => {
        input.value = clamp(parseInt(input.value||'0',10)-1, 0, 9999);
        p.rows[fine.id] = Number(input.value);
        savePlayers(players); updateAmounts(table, p);
      });
      plus.addEventListener('click', () => {
        input.value = clamp(parseInt(input.value||'0',10)+1, 0, 9999);
        p.rows[fine.id] = Number(input.value);
        savePlayers(players); updateAmounts(table, p);
      });
      input.addEventListener('change', () => {
        input.value = clamp(parseInt(input.value||'0',10), 0, 9999);
        p.rows[fine.id] = Number(input.value);
        savePlayers(players); updateAmounts(table, p);
      });

      tdCount.appendChild(wrap);

    } else { // check eller derived-check
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

// Beløbsberegning for alle typer – inkl. derived-check
function calcAmount(player, fine) {
  if (!fine) return 0;
  if (fine.type === 'count') {
    const n = Number(player.rows[fine.id] || 0);
    const v = getFineValue(fine.id);
    return n * v;
  }
  if (fine.type === 'check') {
    const v = getFineValue(fine.id);
    return player.rows[fine.id] ? v : 0;
  }
  if (fine.type === 'derived-check') {
    if (!player.rows[fine.id]) return 0;      // kun når den er krydset af
    const src = FINE_MAP[fine.source];
    return calcAmount(player, src);           // samme beløb som Misset Green
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

/** Events **/
addBtn.addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) { nameInput.focus(); return; }
  addPlayer(name);
  nameInput.value = '';
});
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addBtn.click(); });

resetBtn.addEventListener('click', () => { document.body.classList.add('modal-open'); overlay.classList.remove('hidden'); });
confirmNo.addEventListener('click', () => { overlay.classList.add('hidden'); document.body.classList.remove('modal-open'); });
confirmYes.addEventListener('click', () => {
  overlay.classList.add('hidden'); document.body.classList.remove('modal-open');
  // Kun spillere – behold bødeværdier
  localStorage.removeItem(STORAGE_KEY);
  removeAllPlayers();
});

// Initial render
if (players.length > 0) { activePlayerId = players[0].id; }
render();
