// Entry point: avvia il client Discord, carica i comandi e gestisce le interazioni.
// Niente intents privilegiati: questa app risponde solo a slash command.

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, Events, GatewayIntentBits } = require('discord.js');
const { startWebServer } = require('./services/webServer');

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('[FATAL] DISCORD_TOKEN non impostato. Copia .env.example in .env e compila i campi.');
  process.exit(1);
}

const client = new Client({
  // Per un'app user-install che risponde solo a slash command non servono intents privilegiati.
  intents: [GatewayIntentBits.Guilds],
});

// ---- Carica tutti i comandi da src/commands/*.js ----
client.commands = new Collection();
const commandsDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'))) {
  const cmd = require(path.join(commandsDir, file));
  if (cmd?.data?.name && typeof cmd.execute === 'function') {
    client.commands.set(cmd.data.name, cmd);
    console.log(`[load] comando registrato: /${cmd.data.name}`);
  } else {
    console.warn(`[load] file ignorato (manca data/execute): ${file}`);
  }
}

// ---- Gestione interazioni ----
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;

  try {
    await cmd.execute(interaction);
  } catch (err) {
    console.error(`[error] /${interaction.commandName}:`, err);
    const payload = {
      content: `Errore interno: \`${err?.message || 'sconosciuto'}\``,
    };
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload);
      } else {
        await interaction.reply(payload);
      }
    } catch {
      // ignora: probabilmente token interazione scaduto
    }
  }
});

client.once(Events.ClientReady, (c) => {
  console.log(`[ready] connesso come ${c.user.tag} (id ${c.user.id})`);
  console.log('[ready] in attesa di slash command in DM/Group DM degli utenti che hanno installato l\'app.');
});

client.on(Events.Error,    (e) => console.error('[discord:error]', e));
client.on(Events.Warn,     (m) => console.warn('[discord:warn]', m));

// ---- Web server (per Render keep-alive + UptimeRobot) ----
// Avviato PRIMA del login Discord: cosi su Render free il bind della porta
// avviene subito e Render considera il deploy "live" senza aspettare il bot.
const webServer = startWebServer({ client });

// ---- Login Discord ----
client.login(token).catch((err) => {
  console.error('[discord] login fallito:', err?.message || err);
  // Il web server resta su, cosi /health continua a rispondere e su Render
  // si vede subito che il problema e' nel bot, non nell'app.
});

// Chiusura pulita
function shutdown(sig) {
  console.log(`[shutdown] ricevuto ${sig}, esco.`);
  try { webServer?.close?.(); } catch { /* ignora */ }
  client.destroy().finally(() => process.exit(0));
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
