// Carica la configurazione "effettiva" per il controllo bici.
// Precedenza: valori salvati in DB tramite /config_bici > valori da .env.

const db = require('../services/database');

function splitCsv(s) {
  if (!s) return [];
  return String(s)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function loadEffectiveConfig() {
  return {
    url:
      db.getConfig('product_url') ||
      process.env.DEFAULT_PRODUCT_URL ||
      '',
    expectedName:
      db.getConfig('product_name') ||
      process.env.DEFAULT_PRODUCT_NAME ||
      '',
    outOfStockWords: splitCsv(db.getConfig('out_words')),
    inStockWords:    splitCsv(db.getConfig('in_words')),
    cartSelector:    db.getConfig('cart_selector') || '',
    variant:         db.getConfig('variant') || '',
  };
}

module.exports = { loadEffectiveConfig };
