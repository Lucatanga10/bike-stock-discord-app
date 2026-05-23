// Controllore disponibilita bici.
// Strategia anti-falsi-positivi: combina piu segnali e dichiara DISPONIBILE
// solo se TUTTI quelli rilevanti concordano.
//
// Segnali raccolti:
//   1. Endpoint Shopify {product}.js -> available, variants[].available, title, price
//   2. JSON-LD Product (schema.org) -> offers.availability
//   3. Pagina HTML caricata con Playwright (browser reale):
//        - bottone "Add to cart" / "Aggiungi al carrello" presente, visibile, non disabled
//        - testi tipo "Sold out", "Esaurito", ecc. assenti dal blocco acquisto
//   4. Nome prodotto trovato corrisponde a quello atteso (config)
//
// La logica e tarata sul caso d'uso Shopify (es. collectivebikes.com) ma resta
// generica per altri siti grazie ai selettori e alle parole configurabili.

const { request } = require('undici');
const { chromium } = require('playwright');

// Configurazione di default (puo essere sovrascritta da DB/.env)
const DEFAULTS = {
  outOfStockWords: [
    'sold out',
    'out of stock',
    'currently unavailable',
    'esaurito',
    'fuori scorta',
    'non disponibile',
    'temporaneamente non disponibile',
    'variant sold out or unavailable',
  ],
  inStockWords: [
    'add to cart',
    'aggiungi al carrello',
    'buy now',
    'acquista ora',
    'compra ora',
  ],
  // Selettori CSS comuni per il bottone "Aggiungi al carrello" su Shopify.
  cartSelector: 'button[name="add"], form[action*="/cart/add"] button[type="submit"], button.product-form__submit',
  // Timeout per richieste HTTP / navigazione pagina.
  httpTimeoutMs: 15_000,
  pageTimeoutMs: 30_000,
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

/**
 * Costruisce l'URL .js Shopify a partire dall'URL prodotto.
 * Es: https://shop.com/products/foo?variant=1 -> https://shop.com/products/foo.js
 */
function buildShopifyJsonUrl(productUrl) {
  try {
    const u = new URL(productUrl);
    // mantiene solo il path della pagina prodotto
    if (!u.pathname.includes('/products/')) return null;
    const cleanPath = u.pathname.replace(/\/$/, '').split('?')[0];
    if (cleanPath.endsWith('.js')) return `${u.origin}${cleanPath}`;
    return `${u.origin}${cleanPath}.js`;
  } catch {
    return null;
  }
}

/** Recupera il JSON Shopify del prodotto. Ritorna null se non disponibile / non Shopify. */
async function fetchShopifyJson(productUrl, opts) {
  const jsonUrl = buildShopifyJsonUrl(productUrl);
  if (!jsonUrl) return null;
  try {
    const res = await request(jsonUrl, {
      method: 'GET',
      headers: {
        'user-agent': opts.userAgent,
        accept: 'application/json',
      },
      bodyTimeout: opts.httpTimeoutMs,
      headersTimeout: opts.httpTimeoutMs,
    });
    if (res.statusCode !== 200) return null;
    const ct = res.headers['content-type'] || '';
    if (!String(ct).includes('json')) return null;
    return await res.body.json();
  } catch {
    return null;
  }
}

/**
 * Formatta un prezzo in centesimi (Shopify) come stringa leggibile.
 * Senza valuta esplicita; la valuta vera la lasciamo all'HTML.
 */
function formatPriceFromCents(cents) {
  if (typeof cents !== 'number') return null;
  return (cents / 100).toFixed(2);
}

/**
 * Carica la pagina con Playwright e raccoglie segnali HTML.
 * Restituisce un oggetto con: title, priceText, hasOutWord, hasInStockSignal,
 * cartButtonEnabled, jsonLd, error?.
 */
async function fetchHtmlSignals(productUrl, opts) {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
    });
    const ctx = await browser.newContext({
      userAgent: opts.userAgent,
      locale: 'en-GB',
      viewport: { width: 1280, height: 800 },
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(opts.pageTimeoutMs);
    page.setDefaultNavigationTimeout(opts.pageTimeoutMs);

    await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: opts.pageTimeoutMs });

    // Lascia un piccolo respiro per JS lato client (varianti, prezzi dinamici).
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});

    const pageTitle = await page.title().catch(() => '');

    // Tenta di estrarre h1 (nome prodotto)
    const h1Text = await page
      .locator('h1')
      .first()
      .innerText()
      .catch(() => '');

    // Testo intero della pagina, in lowercase, per ricerca parole chiave.
    const bodyTextLower = (await page.evaluate(() => document.body?.innerText || ''))
      .toString()
      .toLowerCase();

    // Stato del bottone "Aggiungi al carrello".
    let cartButtonEnabled = null; // null = non trovato
    let cartButtonText = '';
    try {
      const btn = page.locator(opts.cartSelector).first();
      if (await btn.count()) {
        const isDisabled = await btn.isDisabled().catch(() => false);
        const isVisible = await btn.isVisible().catch(() => false);
        cartButtonText = ((await btn.innerText().catch(() => '')) || '').trim();
        cartButtonEnabled = isVisible && !isDisabled;
      }
    } catch {
      // ignora errori sul singolo selettore
    }

    // Cerca parole "fuori scorta" / "in stock" nel testo pagina.
    const hasOutWord = opts.outOfStockWords.some((w) => bodyTextLower.includes(w.toLowerCase()));
    const hasInStockSignal = opts.inStockWords.some((w) => bodyTextLower.includes(w.toLowerCase()));

    // JSON-LD schema.org/Product (offers.availability).
    let jsonLdAvailability = null;
    let jsonLdPrice = null;
    let jsonLdName = null;
    try {
      const scripts = await page.locator('script[type="application/ld+json"]').allTextContents();
      for (const s of scripts) {
        try {
          const data = JSON.parse(s);
          const arr = Array.isArray(data) ? data : [data];
          for (const node of arr) {
            const type = node && (node['@type'] || node.type);
            if (!type) continue;
            const types = Array.isArray(type) ? type : [type];
            if (!types.map((x) => String(x).toLowerCase()).includes('product')) continue;

            if (node.name) jsonLdName = String(node.name);
            const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
            if (offers) {
              if (offers.price) jsonLdPrice = String(offers.price);
              if (offers.availability) {
                jsonLdAvailability = String(offers.availability).toLowerCase();
              }
            }
          }
        } catch {
          /* ignora json malformato */
        }
      }
    } catch {
      /* ignora */
    }

    return {
      ok: true,
      pageTitle,
      h1Text,
      cartButtonEnabled,
      cartButtonText,
      hasOutWord,
      hasInStockSignal,
      jsonLdAvailability,
      jsonLdPrice,
      jsonLdName,
    };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Esegue UN controllo completo della pagina.
 *
 * Ritorna:
 *   {
 *     status: 'available' | 'out_of_stock' | 'error',
 *     name, price, url, variant,
 *     reasons: string[],       // perche e arrivato a questo verdetto
 *     signals: { ... },        // dati grezzi (utili per debug/log)
 *   }
 */
async function performSingleCheck(config) {
  const opts = {
    userAgent: DEFAULTS.userAgent,
    httpTimeoutMs: DEFAULTS.httpTimeoutMs,
    pageTimeoutMs: DEFAULTS.pageTimeoutMs,
    cartSelector: config.cartSelector || DEFAULTS.cartSelector,
    outOfStockWords: (config.outOfStockWords && config.outOfStockWords.length
      ? config.outOfStockWords
      : DEFAULTS.outOfStockWords),
    inStockWords: (config.inStockWords && config.inStockWords.length
      ? config.inStockWords
      : DEFAULTS.inStockWords),
  };

  const reasons = [];
  const signals = {};

  // === 1) Shopify JSON (segnale piu affidabile se disponibile) ===
  const shopify = await fetchShopifyJson(config.url, opts);
  signals.shopify = shopify || null;

  let shopifyAvailable = null; // null = sconosciuto
  let nameFromShopify = null;
  let priceFromShopify = null;

  if (shopify && typeof shopify.available === 'boolean') {
    nameFromShopify = shopify.title || null;

    // Se l'utente ha specificato una variante (per titolo o id), filtriamo su quella.
    if (config.variant && Array.isArray(shopify.variants)) {
      const want = String(config.variant).trim().toLowerCase();
      const v = shopify.variants.find((x) => {
        return (
          String(x.id) === want ||
          String(x.title || '').toLowerCase() === want ||
          String(x.option1 || '').toLowerCase() === want ||
          String(x.option2 || '').toLowerCase() === want ||
          String(x.option3 || '').toLowerCase() === want
        );
      });
      if (v) {
        shopifyAvailable = !!v.available;
        priceFromShopify = formatPriceFromCents(v.price);
        reasons.push(`Shopify variant "${v.title}" available=${shopifyAvailable}`);
      } else {
        reasons.push(`Variante "${config.variant}" non trovata su Shopify (segnale ignorato).`);
      }
    }

    if (shopifyAvailable === null) {
      // Nessuna variante richiesta o non trovata: usa lo stato globale.
      shopifyAvailable = !!shopify.available;
      // Prezzo della prima variante disponibile se non lo abbiamo gia.
      if (!priceFromShopify && Array.isArray(shopify.variants) && shopify.variants[0]) {
        priceFromShopify = formatPriceFromCents(shopify.variants[0].price);
      } else if (!priceFromShopify && typeof shopify.price === 'number') {
        priceFromShopify = formatPriceFromCents(shopify.price);
      }
      reasons.push(`Shopify product.available=${shopifyAvailable}`);
    }
  } else {
    reasons.push('Endpoint Shopify .js non disponibile (sito non Shopify o errore).');
  }

  // === 2) HTML reale via Playwright ===
  const html = await fetchHtmlSignals(config.url, opts);
  signals.html = html;

  if (!html.ok) {
    return {
      status: 'error',
      name: nameFromShopify || config.expectedName || null,
      price: priceFromShopify,
      url: config.url,
      variant: config.variant || null,
      reasons: [...reasons, `Errore Playwright: ${html.error}`],
      signals,
    };
  }

  // Validazione nome prodotto: se l'utente ha settato un nome atteso, controlla coincidenza.
  if (config.expectedName) {
    const expected = String(config.expectedName).trim().toLowerCase();
    const found =
      (html.h1Text || '').toLowerCase().includes(expected) ||
      (html.pageTitle || '').toLowerCase().includes(expected) ||
      (nameFromShopify || '').toLowerCase().includes(expected) ||
      (html.jsonLdName || '').toLowerCase().includes(expected);
    if (!found) {
      reasons.push(
        `Nome prodotto atteso "${config.expectedName}" NON trovato nella pagina ` +
          `(h1="${html.h1Text}", title="${html.pageTitle}"). Considero come errore per sicurezza.`,
      );
      return {
        status: 'error',
        name: html.h1Text || nameFromShopify || html.pageTitle || null,
        price: priceFromShopify || html.jsonLdPrice || null,
        url: config.url,
        variant: config.variant || null,
        reasons,
        signals,
      };
    }
  }

  // === 3) JSON-LD ===
  let jsonLdAvailable = null;
  if (html.jsonLdAvailability) {
    if (html.jsonLdAvailability.includes('instock')) jsonLdAvailable = true;
    else if (html.jsonLdAvailability.includes('outofstock')) jsonLdAvailable = false;
    reasons.push(`JSON-LD availability=${html.jsonLdAvailability}`);
  }

  // === 4) HTML: bottone + parole ===
  if (html.cartButtonEnabled !== null) {
    reasons.push(`HTML cart button enabled=${html.cartButtonEnabled} text="${html.cartButtonText}"`);
  }
  if (html.hasOutWord) reasons.push('HTML contiene parole "fuori scorta".');
  if (html.hasInStockSignal) reasons.push('HTML contiene parole "in stock"/"add to cart".');

  // === Verdetto combinato ===
  // DISPONIBILE = TUTTI i segnali rilevanti concordano:
  //   - Shopify dice available=true (se segnale presente)
  //   - JSON-LD dice InStock (se segnale presente)
  //   - bottone esiste, e visibile, e non disabilitato (se trovato)
  //   - nessuna parola "fuori scorta" nel testo
  //
  // Se ANCHE UNO solo dei segnali rilevanti dice "fuori scorta", verdetto = OUT.
  const votes = [];
  if (shopifyAvailable !== null) votes.push({ src: 'shopify', avail: shopifyAvailable });
  if (jsonLdAvailable !== null)  votes.push({ src: 'jsonld',  avail: jsonLdAvailable });
  if (html.cartButtonEnabled !== null) {
    // Se il testo del bottone e' tipo "Sold out", trattalo come OUT.
    const btnTextLow = (html.cartButtonText || '').toLowerCase();
    const btnSaysOut = opts.outOfStockWords.some((w) => btnTextLow.includes(w.toLowerCase()));
    if (btnSaysOut) {
      votes.push({ src: 'btn', avail: false });
    } else {
      votes.push({ src: 'btn', avail: html.cartButtonEnabled });
    }
  }
  // "hasOutWord" e' rumoroso (es. footer "Out of stock notifications"), lo usiamo
  // solo come *veto* se non abbiamo nessun altro segnale.
  if (votes.length === 0) {
    if (html.hasOutWord) votes.push({ src: 'text', avail: false });
    else if (html.hasInStockSignal) votes.push({ src: 'text', avail: true });
  }

  if (votes.length === 0) {
    return {
      status: 'error',
      name: nameFromShopify || html.h1Text || null,
      price: priceFromShopify || html.jsonLdPrice || null,
      url: config.url,
      variant: config.variant || null,
      reasons: [...reasons, 'Nessun segnale di disponibilita riconosciuto: impossibile decidere.'],
      signals,
    };
  }

  const anyOut = votes.some((v) => v.avail === false);
  const verdict = anyOut ? 'out_of_stock' : 'available';
  reasons.push(`Voti: ${votes.map((v) => `${v.src}=${v.avail ? 'IN' : 'OUT'}`).join(', ')} -> ${verdict}`);

  return {
    status: verdict,
    name: nameFromShopify || html.h1Text || html.pageTitle || null,
    price: priceFromShopify || html.jsonLdPrice || null,
    url: config.url,
    variant: config.variant || null,
    reasons,
    signals,
  };
}

/**
 * DOPPIO CONTROLLO con attesa di ~20s tra i due.
 * Se entrambi dicono "available" -> DISPONIBILE (verde).
 * Se primo "available" e secondo no -> UNCERTAIN (giallo).
 * Altrimenti -> OUT/ERROR del primo controllo.
 */
async function performDoubleCheck(config, waitMs = 20_000) {
  const first = await performSingleCheck(config);

  // Se gia il primo non e available, niente attesa: ritorna subito.
  if (first.status !== 'available') return { ...first, doubleChecked: false };

  // Aspetta e ricontrolla.
  await new Promise((r) => setTimeout(r, waitMs));
  const second = await performSingleCheck(config);

  if (second.status === 'available') {
    return {
      ...second,
      doubleChecked: true,
      reasons: [...first.reasons, '--- secondo controllo ---', ...second.reasons],
    };
  }

  return {
    status: 'uncertain',
    name: first.name || second.name,
    price: first.price || second.price,
    url: config.url,
    variant: config.variant || null,
    doubleChecked: true,
    reasons: [
      ...first.reasons,
      '--- secondo controllo (dopo attesa) ---',
      ...second.reasons,
      'Primo controllo: AVAILABLE, secondo: ' + second.status.toUpperCase() + '. Verdetto: UNCERTAIN.',
    ],
    signals: { first: first.signals, second: second.signals },
  };
}

module.exports = {
  performSingleCheck,
  performDoubleCheck,
  DEFAULTS,
};
