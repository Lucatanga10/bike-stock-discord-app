# bike-stock-discord-app

App Discord **User-Installable** che monitora a comando la disponibilità di una bici online (configurato di default per [Collective Bikes C100 V3 MTB - Aqua Blue](https://www.collectivebikes.com/products/c100-v3-mtb-aqua-blue), ma funziona su qualunque shop Shopify e – in modalità HTML – su shop generici).

I comandi funzionano direttamente nei **DM** e nei **Group DM** Discord, senza dover invitare un bot in un server. Le risposte sono **pubbliche nel gruppo**, mai ephemeral.

## Comandi

| Comando | Cosa fa |
|---|---|
| `/check_bici` | Controlla la pagina in tempo reale con **doppio controllo (≈20 s di pausa)** per evitare falsi positivi. Cooldown 30 s/utente. |
| `/stato_bici` | Mostra l’ultimo risultato salvato nel database, senza rifare il controllo. |
| `/config_bici …` | Subcommands per cambiare URL, nome atteso, parole "fuori scorta", selettore CSS, variante. **Solo il proprietario** (`OWNER_DISCORD_ID`). |

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
├── README.md
├── data/
│   └── stock.json      (creato al primo run)
└── src/
    ├── index.js
    ├── deploy-commands.js
    ├── commands/
    │   ├── check_bici.js
    │   ├── stato_bici.js
    │   └── config_bici.js
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

### Setup Render

1. Crea un nuovo **Web Service** su [Render](https://render.com), collegandolo al repo Git che contiene questo progetto.
2. **Environment**: `Node`.
3. **Build Command**: `npm install`
4. **Start Command**: `npm start`
5. In **Environment Variables** aggiungi:
   - `DISCORD_TOKEN`
   - `DISCORD_CLIENT_ID`
   - `OWNER_DISCORD_ID`
   - `DEFAULT_PRODUCT_URL`
   - `DEFAULT_PRODUCT_NAME`
   - (opzionale) `PORT` — **non serve**, Render lo inietta automaticamente; il codice legge `process.env.PORT || 3000`.
6. Deploy. Render assegna un URL pubblico tipo `https://bike-stock-discord-app.onrender.com`.
7. Apri `https://NOME-APP.onrender.com/health` → deve rispondere il JSON sopra.
8. Esegui **una volta** `npm run deploy` **in locale** (o aggiungi un Job temporaneo su Render) per registrare i comandi globali su Discord — basta farlo una volta per applicazione, non a ogni deploy.

> **Importante – filesystem effimero**: il filesystem di Render Free viene **azzerato a ogni redeploy/restart**. Significa che il file `data/stock.json` (config impostata via `/config_bici` + storico controlli) si perde. Per la config questo va bene se imposti URL e nome bici nelle **Environment Variables** del servizio (`DEFAULT_PRODUCT_URL`, `DEFAULT_PRODUCT_NAME`): quelli sopravvivono ai restart. Se ti serve persistenza reale per `/config_bici` su Render, attiva un **Persistent Disk** (a pagamento) e monta `/data` lì, oppure passa a un piano con disco persistente.

### Setup UptimeRobot

1. Account gratuito su [uptimerobot.com](https://uptimerobot.com).
2. **Add New Monitor**:
   - **Monitor Type**: `HTTP(s)`
   - **Friendly Name**: `Bike Stock App`
   - **URL**: `https://NOME-APP.onrender.com/health`
   - **Monitoring Interval**: `5 minutes`
3. Salva. Da quel momento UptimeRobot pinga ogni 5 minuti e Render non andrà più in sleep.

> Funziona anche con altri uptime monitor (Better Stack, cron-job.org, ecc.): basta che facciano una GET a `/health` ogni 5 min.

## Risoluzione problemi

- **`Executable doesn't exist at .../chromium...`** (Playwright) → `npx playwright install chromium`.
- **Il comando non appare in Discord** → aspetta qualche minuto (comandi globali), oppure controlla che `npm run deploy` sia andato a buon fine e che tu abbia *installato l’app sull’utente* tramite il link del Developer Portal.
- **La risposta dice sempre "errore"** → usa `/config_bici show` per verificare la config; controlla i log dell’app (le `reasons` vengono salvate in `data/stock.json` e logate in console).
- **Voglio resettare tutto lo storico/config** → ferma l'app e cancella `data/stock.json`. Verra ricreato vuoto al prossimo avvio.
