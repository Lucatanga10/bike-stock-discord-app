// Controllore disponibilita bici.
// Strategia anti-falsi-positivi: combina piu segnali e dichiara DISPONIBILE
// solo se TUTTI quelli rilevanti concordano.
//
// Segnali raccolti:
//   1. Endpoint Shopify {product}.js  -> available, variants[].available, title, price
//   2. JSON-LD Product (schema.org)   -> offers.availability
//   3. Pagina HTML caricata con Playwright (browser reale):
//        - bottone "Add to cart" / "Aggiungi al carrello" presente, visibile, non disabled
//        - testi tipo "Sold out", "Esaurito", ecc. assenti dal blocco acquisto
//   4. Nome prodotto trovato corrisponde a quello atteso (config)
//
// Diagnostica:
//   - Ogni risultato include un campo "phase" se finisce in errore.
//   - I "signals" contengono dati grezzi (httpStatus, matchedOutWords, ecc.)
//     usati da /debug_bici per investigare i falsi negativi / errori.

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
    if (!u.pathname.includes('/products/')) return null;
    const cleanPath = u.pathname.replace(/\/$/, '').split('?')[0];
    if (cleanPath.endsWith('.js')) return `${u.origin}${cleanPath}`;
    return `${u.origin}${cleanPath}.js`;
  } catch {
    return null;
  }
}

/**
 * Recupera il JSON Shopify del prodotto.
 * Ritorna { ok, data, statusCode, error?, phase? }.
 */
async function fetchShopifyJson(productUrl, opts) {
  const jsonUrl = buildShopifyJsonUrl(productUrl);
  if (!jsonUrl) return { ok: false, data: null, statusCode: null, error: 'URL non Shopify-like', phase: 'shopify_url_build' };

  try {
    const res = await request(jsonUrl, {
      method: 'GET',
      headers: { 'user-agent': opts.userAgent, accept: 'application/json' },
      bodyTimeout: opts.httpTimeoutMs,
      headersTimeout: opts.httpTimeoutMs,
    });
    if (res.statusCode !== 200) {
      // svuota il body per evitare leak
      try { await res.body.dump(); } catch { /* noop */ }
      return { ok: false, data: null, statusCode: res.statusCode, error: `HTTP ${res.statusCode}`, phase: 'shopify_http' };
    }
    const ct = String(res.headers['content-type'] || '');
    if (!ct.includes('json')) {
      try { await res.body.dump(); } catch { /* noop */ }
      return { ok: false, data: null, statusCode: res.statusCode, error: `Content-Type non JSON: ${ct}`, phase: 'shopify_content_type' };
    }
    const data = await res.body.json();
    return { ok: true, data, statusCode: res.statusCode };
  } catch (err) {
    return {
      ok: false,
      data: null,
      statusCode: null,
      error: err?.message || String(err),
      phase: 'shopify_fetch',
    };
  }
}

/** Formatta un prezzo in centesimi (Shopify) come stringa leggibile. */
function formatPriceFromCents(cents) {
  if (typeof cents !== 'number') return null;
  return (cents / 100).toFixed(2);
}

/**
 * Carica la pagina con Playwright e raccoglie segnali HTML.
 * Restituisce un oggetto con tutti i dati utili al debug.
 */
async function fetchHtmlSignals(productUrl, opts) {
  let browser;
  let currentPhase = 'browser_launch';
  try {
    browser = await chromium.launch({ headless: true });

    currentPhase = 'context_create';
    const ctx = await browser.newContext({
      userAgent: opts.userAgent,
      locale: 'en-GB',
      viewport: { width: 1280, height: 800 },
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(opts.pageTimeoutMs);
    page.setDefaultNavigationTimeout(opts.pageTimeoutMs);

    currentPhase = 'page_goto';
    const response = await page.goto(productUrl, {
      waitUntil: 'domcontentloaded',
      timeout: opts.pageTimeoutMs,
    });
    const httpStatus = response ? response.status() : null;

    currentPhase = 'page_settle';
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});

    currentPhase = 'extract_title';
    const pageTitle = await page.title().catch(() => '');
    const h1Text = await page
      .locator('h1')
      .first()
      .innerText()
      .catch(() => '');

    currentPhase = 'extract_body_text';
    const bodyTextLower = (await page.evaluate(() => document.body?.innerText || ''))
      .toString()
      .toLowerCase();

    currentPhase = 'cart_button';
    let cartButtonEnabled = null;
    let cartButtonText = '';
    let cartButtonFound = false;
    try {
      const btn = page.locator(opts.cartSelector).first();
      if (await btn.count()) {
        cartButtonFound = true;
        const isDisabled = await btn.isDisabled().catch(() => false);
        const isVisible  = await btn.isVisible().catch(() => false);
        cartButtonText = ((await btn.innerText().catch(() => '')) || '').trim();
        cartButtonEnabled = isVisible && !isDisabled;
      }
    } catch { /* ignora errori sul singolo selettore */ }

    currentPhase = 'keyword_match';
    const matchedOutWords = opts.outOfStockWords.filter((w) => bodyTextLower.includes(w.toLowerCase()));
    const matchedInWords  = opts.inStockWords.filter((w) => bodyTextLower.includes(w.toLowerCase()));

    currentPhase = 'json_ld';
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
              if (offers.price)        jsonLdPrice        = String(offers.price);
              if (offers.availability) jsonLdAvailability = String(offers.availability).toLowerCase();
            }
          }
        } catch { /* ignora json malformato */ }
      }
    } catch { /* ignora */ }

    return {
      ok: true,
      httpStatus,
      pageTitle,
      h1Text,
      cartButtonFound,
      cartButtonEnabled,
      cartButtonText,
      matchedOutWords,
      matchedInWords,
      hasOutWord: matchedOutWords.length > 0,
      hasInStockSignal: matchedInWords.length > 0,
      jsonLdAvailability,
      jsonLdPrice,
      jsonLdName,
    };
  } catch (err) {
    return {
      ok: false,
      phase: currentPhase,
      errorName: err?.name || 'Error',
      error: err?.message || String(err),
      errorStack: err?.stack || null,
    };
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
 *     reasons: string[],
 *     signals: { shopify, html },
 *     // Presenti solo se status === 'error':
 *     errorName, errorMessage, errorPhase, errorStack,
 *   }
 */
async function performSingleCheck(config) {
  const opts = {
    userAgent: DEFAULTS.userAgent,
    httpTimeoutMs: DEFAULTS.httpTimeoutMs,
    pageTimeoutMs: DEFAULTS.pageTimeoutMs,
    cartSelector: config.cartSelector || DEFAULTS.cartSelector,
    outOfStockWords:
      config.outOfStockWords && config.outOfStockWords.length
        ? config.outOfStockWords
        : DEFAULTS.outOfStockWords,
    inStockWords:
      config.inStockWords && config.inStockWords.length
        ? config.inStockWords
        : DEFAULTS.inStockWords,
  };

  const reasons = [];
  const signals = {};

  // === 1) Shopify JSON ===
  const shopify = await fetchShopifyJson(config.url, opts);
  signals.shopify = shopify;

  let shopifyAvailable = null;
  let nameFromShopify = null;
  let priceFromShopify = null;

  if (shopify.ok && shopify.data && typeof shopify.data.available === 'boolean') {
    const sd = shopify.data;
    nameFromShopify = sd.title || null;

    if (config.variant && Array.isArray(sd.variants)) {
      const want = String(config.variant).trim().toLowerCase();
      const v = sd.variants.find((x) =>
        String(x.id) === want ||
        String(x.title || '').toLowerCase() === want ||
        String(x.option1 || '').toLowerCase() === want ||
        String(x.option2 || '').toLowerCase() === want ||
        String(x.option3 || '').toLowerCase() === want,
      );
      if (v) {
        shopifyAvailable = !!v.available;
        priceFromShopify = formatPriceFromCents(v.price);
        reasons.push(`Shopify variant "${v.title}" available=${shopifyAvailable}`);
      } else {
        reasons.push(`Variante "${config.variant}" non trovata su Shopify (segnale ignorato).`);
      }
    }

    if (shopifyAvailable === null) {
      shopifyAvailable = !!sd.available;
      if (!priceFromShopify && Array.isArray(sd.variants) && sd.variants[0]) {
        priceFromShopify = formatPriceFromCents(sd.variants[0].price);
      } else if (!priceFromShopify && typeof sd.price === 'number') {
        priceFromShopify = formatPriceFromCents(sd.price);
      }
      reasons.push(`Shopify product.available=${shopifyAvailable}`);
    }
  } else {
    reasons.push(`Shopify .js non disponibile (${shopify.error || 'sito non Shopify'}, phase=${shopify.phase || 'n/a'}).`);
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
      errorName:    html.errorName    || 'PlaywrightError',
      errorMessage: html.error        || 'Errore Playwright sconosciuto',
      errorPhase:   html.phase        || 'playwright',
      errorStack:   html.errorStack   || null,
      reasons: [...reasons, `Errore [${html.phase || 'playwright'}]: ${html.error}`],
      signals,
    };
  }

  // === Validazione nome prodotto ===
  if (config.expectedName) {
    const expected = String(config.expectedName).trim().toLowerCase();
    const found =
      (html.h1Text || '').toLowerCase().includes(expected) ||
      (html.pageTitle || '').toLowerCase().includes(expected) ||
      (nameFromShopify || '').toLowerCase().includes(expected) ||
      (html.jsonLdName || '').toLowerCase().includes(expected);
    if (!found) {
      const msg =
        `Nome prodotto atteso "${config.expectedName}" NON trovato (h1="${html.h1Text}", title="${html.pageTitle}").`;
      reasons.push(msg);
      return {
        status: 'error',
        name: html.h1Text || nameFromShopify || html.pageTitle || null,
        price: priceFromShopify || html.jsonLdPrice || null,
        url: config.url,
        variant: config.variant || null,
        errorName: 'NameMismatch',
        errorMessage: msg,
        errorPhase: 'name_validation',
        reasons,
        signals,
      };
    }
  }

  // === 3) JSON-LD ===
  let jsonLdAvailable = null;
  if (html.jsonLdAvailability) {
    if (html.jsonLdAvailability.includes('instock'))         jsonLdAvailable = true;
    else if (html.jsonLdAvailability.includes('outofstock')) jsonLdAvailable = false;
    reasons.push(`JSON-LD availability=${html.jsonLdAvailability}`);
  }

  // === 4) Bottone + parole ===
  if (html.cartButtonFound) {
    reasons.push(`HTML cart button enabled=${html.cartButtonEnabled} text="${html.cartButtonText}"`);
  } else {
    reasons.push('HTML cart button: non trovato col selettore corrente.');
  }
  if (html.matchedOutWords.length) reasons.push(`Parole "fuori scorta" trovate: ${html.matchedOutWords.join(', ')}.`);
  if (html.matchedInWords.length)  reasons.push(`Parole "disponibile" trovate: ${html.matchedInWords.join(', ')}.`);

  // === Verdetto combinato ===
  const votes = [];
  if (shopifyAvailable !== null) votes.push({ src: 'shopify', avail: shopifyAvailable });
  if (jsonLdAvailable !== null)  votes.push({ src: 'jsonld',  avail: jsonLdAvailable });
  if (html.cartButtonEnabled !== null) {
    const btnTextLow = (html.cartButtonText || '').toLowerCase();
    const btnSaysOut = opts.outOfStockWords.some((w) => btnTextLow.includes(w.toLowerCase()));
    votes.push({ src: 'btn', avail: btnSaysOut ? false : html.cartButtonEnabled });
  }
  if (votes.length === 0) {
    if (html.hasOutWord)             votes.push({ src: 'text', avail: false });
    else if (html.hasInStockSignal)  votes.push({ src: 'text', avail: true });
  }

  if (votes.length === 0) {
    const msg = 'Nessun segnale di disponibilita riconosciuto.';
    reasons.push(msg);
    return {
      status: 'error',
      name: nameFromShopify || html.h1Text || null,
      price: priceFromShopify || html.jsonLdPrice || null,
      url: config.url,
      variant: config.variant || null,
      errorName: 'NoSignals',
      errorMessage: msg,
      errorPhase: 'verdict',
      reasons,
      signals,
    };
  }

  const anyOut = votes.some((v) => v.avail === false);
  const verdict = anyOut ? 'out_of_stock' : 'available';
  reasons.push(
    `Voti: ${votes.map((v) => `${v.src}=${v.avail ? 'IN' : 'OUT'}`).join(', ')} -> ${verdict}`,
  );

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
 */
async function performDoubleCheck(config, waitMs = 20_000) {
  const first = await performSingleCheck(config);
  if (first.status !== 'available') return { ...first, doubleChecked: false };

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
      `Primo controllo: AVAILABLE, secondo: ${second.status.toUpperCase()}. Verdetto: UNCERTAIN.`,
    ],
    signals: { first: first.signals, second: second.signals },
  };
}

module.exports = {
  performSingleCheck,
  performDoubleCheck,
  DEFAULTS,
};
