// Registra (o aggiorna) i comandi GLOBALI dell'applicazione Discord.
// Imposta integration_types = [USER_INSTALL] e contexts = [BOT_DM, PRIVATE_CHANNEL]
// cosi i comandi sono utilizzabili nei DM e nei gruppi DM di chi installa l'app.

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');

const token    = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  console.error('[FATAL] DISCORD_TOKEN e DISCORD_CLIENT_ID devono essere impostati nel .env');
  process.exit(1);
}

// Carica le definizioni dei comandi
const commands = [];
const commandsDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'))) {
  const cmd = require(path.join(commandsDir, file));
  if (!cmd?.data) {
    console.warn(`[deploy] file senza .data ignorato: ${file}`);
    continue;
  }
  const json = cmd.data.toJSON();

  // Sicurezza: anche se i builder gia li impostano, ribadiamo i campi
  // critici nel payload JSON inviato a Discord. 1=USER_INSTALL, 1=BOT_DM, 2=PRIVATE_CHANNEL.
  json.integration_types = [1];
  if (!Array.isArray(json.contexts) || json.contexts.length === 0) {
    json.contexts = [1, 2];
  }
  commands.push(json);
  console.log(`[deploy] preparato /${json.name} (integration_types=${JSON.stringify(json.integration_types)}, contexts=${JSON.stringify(json.contexts)})`);
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log(`[deploy] invio ${commands.length} comandi globali a Discord...`);
    const data = await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log(`[deploy] OK, ${Array.isArray(data) ? data.length : '?'} comandi registrati globalmente.`);
    console.log('[deploy] Nota: la propagazione globale puo richiedere fino a ~1 ora.');
  } catch (err) {
    console.error('[deploy] ERRORE:', err);
    process.exit(1);
  }
})();
