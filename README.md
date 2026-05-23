# bike-stock-discord-app

App Discord **User-Installable** che monitora a comando la disponibilità di una bici online (configurato di default per [Collective Bikes C100 V3 MTB - Aqua Blue](https://www.collectivebikes.com/products/c100-v3-mtb-aqua-blue), ma funziona su qualunque shop Shopify e – in modalità HTML – su shop generici).

I comandi funzionano direttamente nei **DM** e nei **Group DM** Discord, senza dover invitare un bot in un server. Le risposte sono **pubbliche nel gruppo**, mai ephemeral.

## Comandi

| Comando | Cosa fa |
|---|---|
| `/check_bici` | Controlla la pagina in tempo reale con **doppio controllo (≈20 s di pausa)** per evitare falsi positivi. Cooldown 30 s/utente. |
| `/stato_bici` | Mostra l’ultimo risultato salvato nel database, senza rifare il controllo. |
| `/config_bici …` | Subcommands per cambiare URL, nome atteso, parole "fuori scorta", selettore CSS, variante. **Solo il proprietario** (`OWNER_DISCORD_ID`). |
| `/debug_bici` | Diagnostica: esegue un controllo singolo e mostra tutti i segnali raccolti (titolo pagina, HTTP status, bottone, parole, JSON-LD, ecc.). **Solo il proprietario**. |

---

## 1. Crea l’applicazione Discord

1. Vai su [Discord Developer Portal](https://discord.com/developers/applications) e premi **"New Application"**.
2. Dai un nome (es. *Bike Stock Monitor*).
3. Nella pagina **General Information** copia l’**Application ID** → lo metterai in `DISCORD_CLIENT_ID`.
4. Vai su **Bot** → premi **"Reset Token"** e copia il token → lo metterai in `DISCORD_TOKEN`.
   - Per questa app **NON serve abilitare nessun intent privilegiato** (Presence/Server Members/Message Content).

## 2. Abilita User Install

1. Sempre nel Developer Portal, vai su **Installation**.
2. In **"Installation Contexts"** spunta **"User Install"** (puoi lasciare anche "Guild Install" se vuoi, ma per questo progetto non serve).
3. In **"Install Link"** scegli **"Discord Provided Link"**.
4. In **"Default Install Settings" → User Install → Scopes** seleziona almeno `applications.commands`.
5. **Salva**. Il link che ti viene mostrato è quello che userai per installare l’app sul tuo account utente.

## 3. Imposta i comandi per `PRIVATE_CHANNEL`

Non devi farlo a mano dal portale: lo script `npm run deploy` registra i comandi in modo GLOBALE con i seguenti campi nel payload:

```json
{
  "integration_types": [1],
  "contexts": [1, 2]
}
```

dove:

- `integration_types: [1]` = **USER_INSTALL** (l’app si installa sull’account utente)
- `contexts: [1, 2]` = **BOT_DM (1)** e **PRIVATE_CHANNEL (2)**: i comandi appaiono nei DM con l’app e nei **Group DM**

> Se vuoi limitare solo ai Group DM, modifica `src/deploy-commands.js` e imposta `json.contexts = [2]`.
> Se vuoi che funzionino anche dentro i server (Guild), aggiungi `0` alla lista contexts e `0` (GUILD_INSTALL) a integration_types.

## 4. Installa le dipendenze

Requisiti: **Node.js ≥ 20** (testato anche su Node 26). **Nessun modulo nativo** da compilare: la persistenza usa un semplice file JSON in `data/stock.json`.

```powershell
cd $env:USERPROFILE\Desktop\bike-stock-discord-app
npm install
```

Lo script `postinstall` lancia automaticamente `playwright install chromium` per scaricare il browser usato per le verifiche HTML. Se la rete blocca quel download puoi rilanciarlo manualmente:

```powershell
npx playwright install chromium
```

## 5. Configura il file `.env`

Copia `.env.example` in `.env` e compila:

```env
DISCORD_TOKEN=il_token_del_bot
DISCORD_CLIENT_ID=application_id
OWNER_DISCORD_ID=il_tuo_user_id
DEFAULT_PRODUCT_URL=https://www.collectivebikes.com/products/c100-v3-mtb-aqua-blue
DEFAULT_PRODUCT_NAME=C100 V3 MTB - Aqua Blue
```

Per ottenere il tuo **User ID**: Impostazioni Discord → Avanzate → abilita "Modalità Sviluppatore", poi click destro sul tuo nome → "Copia ID utente".

## 6. Registra i comandi

```powershell
npm run deploy
```

Output atteso:

```
[deploy] preparato /check_bici (integration_types=[1], contexts=[1,2])
[deploy] preparato /stato_bici  (...)
[deploy] preparato /config_bici (...)
[deploy] OK, 3 comandi registrati globalmente.
```

> I comandi globali possono richiedere fino a ~1 ora per propagarsi. Per testare subito, prova in un DM con l’app: di solito è quasi istantaneo.

## 7. Avvia l’app

```powershell
npm start
```

Vedrai:

```
[load] comando registrato: /check_bici
[load] comando registrato: /config_bici
[load] comando registrato: /stato_bici
[ready] connesso come BikeMonitor#1234 (id ...)
```

L’app deve restare in esecuzione (su PC, server, o servizio tipo Railway/Fly/VPS) per rispondere ai comandi.

## 8. Usa `/check_bici` nel tuo Group DM

1. Apri il link "Install" del Developer Portal (sezione **Installation**) e installa l’app sul tuo account utente.
2. Apri un Group DM Discord.
3. Scrivi `/` → dovresti vedere `/check_bici`, `/stato_bici`, `/config_bici` nell’elenco.
4. Premi invio. La risposta arriva **pubblica nel gruppo** (visibile a tutti i membri).

## 9. Come evitare le risposte ephemeral

Nel codice non viene mai impostato `MessageFlags.Ephemeral` né `ephemeral: true`. Le risposte sono di default visibili a tutti i partecipanti del DM/Group DM. **Non modificare questa parte** se vuoi mantenere le risposte pubbliche.

## 10. Modifica URL e parole di disponibilità

Puoi cambiare la bici monitorata in due modi:

**A. Tramite `.env`** (richiede riavvio):

```env
DEFAULT_PRODUCT_URL=https://altrosito.com/products/altrabici
DEFAULT_PRODUCT_NAME=Nome esatto bici
```

**B. Tramite comando Discord** (a caldo, senza riavvio, e ha precedenza sul `.env`):

```
/config_bici url             value: https://...
/config_bici name            value: Nome bici
/config_bici out_words       value: sold out, esaurito, non disponibile
/config_bici in_words        value: add to cart, aggiungi al carrello
/config_bici cart_selector   value: button[name="add"], form[action*="/cart/add"] button
/config_bici variant         value: Black/Blue       (oppure ID variante Shopify)
/config_bici show            (mostra tutto)
/config_bici reset key:product_url    (azzera una chiave o "all")
```

I valori vengono salvati in `data/stock.json` e usati a ogni `/check_bici`.

---

## Come funziona il controllo (anti-falsi-positivi)

Il file [src/services/bikeChecker.js](src/services/bikeChecker.js) combina più segnali e dichiara la bici DISPONIBILE solo se **tutti** quelli rilevanti concordano:

1. **Shopify JSON endpoint** (`/{handle}.js`): il segnale più affidabile su shop Shopify (incluso Collective Bikes). Espone `available`, `variants[].available`, `title`, `price` in centesimi.
2. **JSON-LD `schema.org/Product`**: parsato dalla pagina HTML, controlla `offers.availability` (`InStock` / `OutOfStock`).
3. **Bottone "Add to cart"**: caricato con Playwright (Chromium headless). Deve essere **presente, visibile e non disabilitato**, e il suo testo non deve contenere parole come "Sold out".
4. **Parole chiave nel testo pagina**: configurabili. Le parole di esaurimento agiscono come *veto*.
5. **Nome prodotto atteso**: se nella pagina non si trova (su `<h1>`, `<title>`, JSON-LD o Shopify), il risultato diventa "errore" per sicurezza (evita di confondere bici diverse).
6. **Variante**: se imposti `/config_bici variant`, viene controllata la disponibilità della *sola* variante richiesta.

Inoltre, prima di rispondere **"BICI DISPONIBILE ORA"**, `/check_bici` esegue **due controlli completi a distanza di ~20 s**. Se il secondo non conferma, lo stato diventa **"Stato incerto"** (giallo) invece che verde.

## Dove mettere selettori/parole corrette per altri siti

- **`src/services/bikeChecker.js`** → costante `DEFAULTS` in cima al file. Contiene:
  - `outOfStockWords` (italiano + inglese): aggiungi parole specifiche del sito.
  - `inStockWords`: parole che indicano la possibilità di acquistare.
  - `cartSelector`: selettori CSS multipli separati da virgola. Per default copre Shopify; per altri shop aggiungi il selettore del bottone di acquisto del sito specifico.
- A runtime gli stessi valori si modificano via `/config_bici` (precedenza sul codice).

### Note specifiche per Collective Bikes (sito di default)

Il sito è Shopify, quindi l’endpoint `https://www.collectivebikes.com/products/c100-v3-mtb-aqua-blue.js` restituisce JSON con `available: false` quando esaurito → l’app si basa **principalmente** su questo segnale, e usa Playwright come verifica incrociata. È molto difficile avere falsi positivi.

---

## Sicurezza e buone pratiche

- Cooldown **30 s/utente** su `/check_bici` (in `src/utils/cooldown.js`).
- Timeout massimo **30 s** per pagina (Playwright) e **15 s** per richieste HTTP.
- Nessun bypass di captcha o protezioni: se il sito risponde con sfide il check va in "errore" e basta.
- User-Agent realistico (Chrome desktop) — nessun comportamento aggressivo, una richiesta alla volta solo quando l’utente lo chiede esplicitamente.
- `/config_bici` è limitato a `OWNER_DISCORD_ID`.
- Non sono usati token utente Discord né self-bot: solo Bot Token ufficiale via discord.js.

## Struttura file

```
bike-stock-discord-app/
├── package.json
├── .env.example
├── .gitignore
├── .dockerignore
├── Dockerfile
├── README.md
├── data/
│   └── stock.json      (creato al primo run)
└── src/
    ├── index.js
    ├── deploy-commands.js
    ├── commands/
    │   ├── check_bici.js
    │   ├── stato_bici.js
    │   ├── config_bici.js
    │   └── debug_bici.js
    ├── services/
    │   ├── bikeChecker.js
    │   ├── database.js
    │   └── webServer.js
    └── utils/
        ├── cooldown.js
        ├── formatMessage.js
        └── loadConfig.js
```

---

## Deploy su Render (free) + UptimeRobot

Render Free mette in sleep i Web Service dopo ~15 min senza traffico HTTP. L'app espone un piccolo server Express (in `src/services/webServer.js`) che UptimeRobot può pingare ogni 5 minuti per tenerla sveglia.

### Endpoint HTTP esposti

| Metodo & Path | Risposta | Uso |
|---|---|---|
| `GET /`         | `200 text/plain` – "bike-stock-discord-app OK" | sanity check |
| `GET /health`   | `200 application/json` (vedi sotto) | UptimeRobot |
| `GET /healthz`  | alias di `/health` | convenzione Kubernetes/Render |

Esempio risposta `GET /health`:

```json
{
  "status": "ok",
  "service": "bike-stock-discord-app",
  "bot": "online",
  "timestamp": "2026-05-23T09:54:11.123Z",
  "uptime": 1234
}
```

`bot` vale `"online"` quando il client Discord ha completato il login, altrimenti `"starting"`. **Nessun endpoint** espone token, configurazione o storico.

### Setup Render (runtime: Docker — OBBLIGATORIO)

> **Perche Docker e non Node**: il runtime Node di Render non include Chromium ne le sue librerie di sistema (libnss3, libatk, ecc.). Anche eseguendo `npx playwright install --with-deps chromium` nel build command, su Render Free fallisce o non riesce a installare le dipendenze APT. La soluzione affidabile e usare l'immagine ufficiale Playwright `mcr.microsoft.com/playwright:v1.60.0-noble` che ha gia tutto preinstallato. Il `Dockerfile` nella root del progetto fa esattamente questo.

1. Crea un nuovo **Web Service** su [Render](https://render.com), collegandolo al repo Git.
2. **Language / Runtime**: **`Docker`** (NON Node).
3. **Root Directory**: lascia vuoto (sia `package.json` che `Dockerfile` sono nella root).
4. **Dockerfile Path**: lascia il default (`./Dockerfile`).
5. **Build Command**: lascia vuoto (Render usa il Dockerfile).
6. **Start Command**: lascia vuoto (definito dal `CMD ["npm", "start"]` nel Dockerfile).
7. In **Environment Variables** aggiungi:
   - `DISCORD_TOKEN`
   - `DISCORD_CLIENT_ID`
   - `OWNER_DISCORD_ID`
   - `DEFAULT_PRODUCT_URL`
   - `DEFAULT_PRODUCT_NAME`
   - **NON serve** `PORT`: Render lo inietta automaticamente; il codice legge `process.env.PORT || 3000`.
8. Deploy. Render builda l'immagine Docker (prima volta ~2-4 min) e poi assegna un URL pubblico tipo `https://bike-stock-discord-app.onrender.com`.
9. Apri `https://NOME-APP.onrender.com/health` → deve rispondere il JSON `{ status: "ok", ... }`.
10. Esegui **una volta** `npm run deploy` **in locale** per registrare i comandi globali su Discord — basta farlo una volta per applicazione, non a ogni deploy.

#### Allineamento versioni Playwright

**Importante**: il tag dell'immagine Docker (`v1.60.0-noble`) e la versione del pacchetto npm `playwright` in `package.json` (`"playwright": "1.60.0"`) **devono coincidere**. Se cambi una, cambia anche l'altra:

```dockerfile
FROM mcr.microsoft.com/playwright:v1.XX.0-noble
```
```json
"playwright": "1.XX.0"
```

Se le versioni non coincidono, Playwright a runtime cerchera un binario di Chromium con una revision diversa da quella presente nell'immagine → di nuovo l'errore *"Executable doesn't exist at /ms-playwright/..."*.

> **Importante – filesystem effimero**: il filesystem di Render Free (Docker o Node che sia) viene **azzerato a ogni redeploy/restart**. Il file `data/stock.json` (config impostata via `/config_bici` + storico controlli) si perde. Per la config questo va bene se imposti URL e nome bici nelle **Environment Variables** del servizio (`DEFAULT_PRODUCT_URL`, `DEFAULT_PRODUCT_NAME`): quelli sopravvivono ai restart. Se ti serve persistenza reale per `/config_bici` su Render, attiva un **Persistent Disk** (a pagamento) e monta `/data` lì.

### Setup UptimeRobot

1. Account gratuito su [uptimerobot.com](https://uptimerobot.com).
2. **Add New Monitor**:
   - **Monitor Type**: `HTTP(s)`
   - **Friendly Name**: `Bike Stock App`
   - **URL**: `https://NOME-APP.onrender.com/health`
   - **Monitoring Interval**: `5 minutes`
3. Salva. Da quel momento UptimeRobot pinga ogni 5 minuti e Render non andrà più in sleep.

> Funziona anche con altri uptime monitor (Better Stack, cron-job.org, ecc.): basta che facciano una GET a `/health` ogni 5 min.

## Diagnostica errori

Quando `/check_bici` finisce in **errore**, su Discord vedi una riga breve tipo:

```
Errore controllo sito [page_goto]: net::ERR_TIMED_OUT
```

mentre sui log del server (Render: **Logs** tab, locale: console di `npm start`) trovi un dump completo:

```js
[check_bici] errore controllo: {
  url: 'https://...',
  expectedName: 'C100 V3 MTB - Aqua Blue',
  variant: null,
  errorName: 'TimeoutError',
  errorPhase: 'page_goto',
  errorMessage: 'page.goto: Timeout 30000ms exceeded.',
  httpStatus: null,
  pageTitle: null,
  cartButtonFound: null,
  matchedOutWords: [],
  reasons: ['Shopify .js non disponibile (HTTP 503, phase=shopify_http).', 'Errore [page_goto]: ...']
}
[check_bici] stack:
TimeoutError: page.goto: Timeout 30000ms exceeded.
    at ...
```

Le **phase** possibili sono:

| Phase | Significato |
|---|---|
| `shopify_url_build` | l'URL non sembra una pagina prodotto Shopify (manca `/products/`) |
| `shopify_http` | l'endpoint `.js` ha risposto != 200 |
| `shopify_content_type` | l'endpoint `.js` non ha risposto JSON |
| `shopify_fetch` | errore di rete sul `.js` (timeout, DNS, TLS, ecc.) |
| `browser_launch` | Playwright non riesce ad avviare Chromium |
| `context_create` | errore creando il browser context |
| `page_goto` | timeout / errore di rete caricando la pagina |
| `page_settle` | timeout aspettando `networkidle` (non causa errore: warning) |
| `extract_title` / `extract_body_text` | errore leggendo titolo / testo pagina |
| `cart_button` | errore valutando il selettore del bottone |
| `keyword_match` / `json_ld` | errore parsando il contenuto |
| `name_validation` | il nome prodotto atteso non si trova nella pagina (sicurezza anti-redirect) |
| `verdict` | nessun segnale di disponibilita riconosciuto (config troppo restrittiva o sito cambiato) |
| `uncaught` | eccezione non prevista (sempre da indagare nello stack) |

### `/debug_bici` (owner-only)

Per investigare a fondo, lancia `/debug_bici` (solo `OWNER_DISCORD_ID`). Esegue un controllo **singolo** (no doppio) e ti restituisce nel canale un embed con tutti i campi:

- URL prodotto
- Nome prodotto atteso
- Pagina caricata si/no + HTTP status
- Titolo pagina, H1
- Bottone carrello: trovato? enabled? testo?
- Parole "fuori scorta" effettivamente matchate
- Parole "disponibile" effettivamente matchate
- JSON-LD: availability, price, name
- Shopify `.js`: ok? HTTP status? available?
- Verdetto finale + motivo

Lo stesso dump viene anche scritto nei log del server (utile per copia/incolla).

## Risoluzione problemi

- **`Executable doesn't exist at .../chromium...`** (Playwright)
  - **In locale**: `npx playwright install chromium`.
  - **Su Render**: stai usando il runtime Node? **Cambialo a Docker** (vedi sezione sopra). Stai usando Docker ma vedi ancora l'errore? Verifica che la versione `mcr.microsoft.com/playwright:vX.Y.Z-noble` nel Dockerfile sia **identica** a `"playwright": "X.Y.Z"` in `package.json`.
- **Build Docker fallita su Render** → guarda i log del build. Cause comuni: tag immagine `playwright:vX.Y.Z-noble` inesistente (controlla i tag su [mcr.microsoft.com/playwright](https://mcr.microsoft.com/en-us/product/playwright/about)), o `.dockerignore` che esclude file necessari.
- **Il comando non appare in Discord** → aspetta qualche minuto (comandi globali), oppure controlla che `npm run deploy` sia andato a buon fine e che tu abbia *installato l’app sull’utente* tramite il link del Developer Portal.
- **La risposta dice "Errore controllo sito"** → guarda i log del server per phase + stack completo, oppure lancia `/debug_bici` nel gruppo per il dump completo nei messaggi.
- **Voglio resettare tutto lo storico/config** → ferma l'app e cancella `data/stock.json`. Verra ricreato vuoto al prossimo avvio.

### Build e test Docker in locale (opzionale)

Se vuoi verificare che l'immagine builda e parte prima di pushare su Render:

```powershell
docker build -t bike-stock .
docker run --rm -p 3000:3000 --env-file .env bike-stock
```

Poi apri http://localhost:3000/health.
