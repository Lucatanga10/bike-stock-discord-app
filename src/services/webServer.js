// Mini server HTTP (Express) per:
//  - tenere sveglia l'app su Render Free (UptimeRobot pinga /health ogni 5 min)
//  - esporre un health-check leggero senza dati sensibili
//
// Endpoint pubblici:
//   GET /         -> 200 testo plain ("bike-stock-discord-app OK")
//   GET /health   -> 200 JSON { status, service, bot, timestamp, uptime }
//   GET /healthz  -> alias di /health (convenzione Kubernetes/Render)
//
// NESSUN endpoint espone token, config sensibile o storico controlli.

const express = require('express');

/**
 * Avvia il server e ritorna l'handle (per shutdown ordinato).
 * @param {Object} options
 * @param {import('discord.js').Client} options.client - client Discord (per stato bot)
 * @param {number} [options.port] - porta (default process.env.PORT || 3000)
 */
function startWebServer({ client, port } = {}) {
  const app = express();
  const PORT = Number(port || process.env.PORT || 3000);

  // Disabilita header X-Powered-By per discrezione.
  app.disable('x-powered-by');

  // Stato bot: 'online' se il client e' pronto, altrimenti 'starting'.
  function botStatus() {
    try {
      // client.isReady() esiste su discord.js v14
      if (client && typeof client.isReady === 'function' && client.isReady()) {
        return 'online';
      }
    } catch { /* ignora */ }
    return 'starting';
  }

  app.get('/', (_req, res) => {
    res.type('text/plain').status(200).send('bike-stock-discord-app OK');
  });

  const healthHandler = (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'bike-stock-discord-app',
      bot: botStatus(),
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
    });
  };
  app.get('/health',  healthHandler);
  app.get('/healthz', healthHandler);

  // 404 minimale, niente stack trace.
  app.use((_req, res) => res.status(404).type('text/plain').send('Not Found'));

  const server = app.listen(PORT, () => {
    console.log(`[web] server in ascolto sulla porta ${PORT} (GET /, /health, /healthz)`);
  });

  server.on('error', (err) => {
    console.error('[web] errore server:', err.message);
  });

  return server;
}

module.exports = { startWebServer };
