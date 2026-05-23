// Layer di persistenza basato su file JSON (data/stock.json).
//
// Scelta: niente SQLite -> niente moduli nativi da compilare.
// L'uso e' "single-process bot Discord" con pochissimi dati, quindi un file
// JSON e' ampiamente sufficiente. La scrittura usa il pattern write-temp+rename
// (atomico su Windows/POSIX) per evitare file corrotti in caso di crash.
//
// API esportata: identica alla versione precedente con better-sqlite3,
// cosi i comandi non vanno toccati.
//   - getConfig(key, fallback?)
//   - setConfig(key, value)
//   - deleteConfig(key)
//   - getAllConfig()
//   - saveCheck({ status, name, price, url, variant, raw })
//   - getLastCheck()

const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR  = path.resolve(__dirname, '..', '..', 'data');
const DB_PATH   = path.join(DATA_DIR, 'stock.json');
const TMP_PATH  = path.join(DATA_DIR, 'stock.json.tmp');

// Quanti check tenere in storico (rolling).
const MAX_HISTORY = 200;

// Stato in memoria
let state = {
  config: {},  // { key: stringValue }
  checks: [],  // array di { ts, status, name, price, url, variant, raw }
};

// --- inizializzazione ---
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (fs.existsSync(DB_PATH)) {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      state.config = parsed.config && typeof parsed.config === 'object' ? parsed.config : {};
      state.checks = Array.isArray(parsed.checks) ? parsed.checks : [];
    }
  } catch (err) {
    console.warn(`[db] stock.json corrotto o illeggibile, riparto vuoto: ${err.message}`);
    // Backup del file corrotto per indagini.
    try {
      fs.copyFileSync(DB_PATH, `${DB_PATH}.broken-${Date.now()}`);
    } catch { /* ignora */ }
  }
}

/** Scrive lo stato su disco in modo atomico. */
function persist() {
  const json = JSON.stringify(state, null, 2);
  fs.writeFileSync(TMP_PATH, json, 'utf8');
  fs.renameSync(TMP_PATH, DB_PATH);
}

// --- API config ---

function getConfig(key, fallback = null) {
  return Object.prototype.hasOwnProperty.call(state.config, key)
    ? state.config[key]
    : fallback;
}

function setConfig(key, value) {
  state.config[key] = String(value);
  persist();
}

function deleteConfig(key) {
  if (Object.prototype.hasOwnProperty.call(state.config, key)) {
    delete state.config[key];
    persist();
  }
}

function getAllConfig() {
  return { ...state.config };
}

// --- API storico controlli ---

function saveCheck({ status, name, price, url, variant, raw }) {
  state.checks.push({
    ts: Date.now(),
    status,
    name:    name    ?? null,
    price:   price   ?? null,
    url:     url     ?? null,
    variant: variant ?? null,
    raw:     raw     ?? null,
  });
  // Mantieni rolling window
  if (state.checks.length > MAX_HISTORY) {
    state.checks = state.checks.slice(-MAX_HISTORY);
  }
  persist();
}

function getLastCheck() {
  if (!state.checks.length) return null;
  return state.checks[state.checks.length - 1];
}

module.exports = {
  getConfig,
  setConfig,
  deleteConfig,
  getAllConfig,
  saveCheck,
  getLastCheck,
};
