// /check_bici - controllo in tempo reale con doppio controllo (20s di pausa).
// Risposta pubblica nel canale/gruppo: nessun flag ephemeral.

const {
  SlashCommandBuilder,
  ApplicationIntegrationType,
  InteractionContextType,
} = require('discord.js');

const { performDoubleCheck } = require('../services/bikeChecker');
const { buildCheckEmbed, buildInfoEmbed } = require('../utils/formatMessage');
const { checkCooldown, markUsed } = require('../utils/cooldown');
const { loadEffectiveConfig } = require('../utils/loadConfig');
const db = require('../services/database');

const COOLDOWN_MS = 30_000; // 30s per utente
const DOUBLE_CHECK_WAIT_MS = 20_000;

const data = new SlashCommandBuilder()
  .setName('check_bici')
  .setDescription('Controlla in tempo reale la disponibilita della bici monitorata.')
  // User-install + funziona in DM (1) e Group DM / PRIVATE_CHANNEL (2).
  .setIntegrationTypes(ApplicationIntegrationType.UserInstall)
  .setContexts(InteractionContextType.BotDM, InteractionContextType.PrivateChannel);

async function execute(interaction) {
  // Cooldown anti-spam per utente
  const cd = checkCooldown(interaction.user.id, 'check_bici', COOLDOWN_MS);
  if (!cd.ok) {
    await interaction.reply({
      embeds: [
        buildInfoEmbed({
          title: 'Aspetta un attimo',
          description: `Devi attendere ancora **${Math.ceil(cd.remainingMs / 1000)}s** prima del prossimo /check_bici.`,
          color: 'uncertain',
        }),
      ],
    });
    return;
  }

  const config = loadEffectiveConfig();
  if (!config.url) {
    await interaction.reply({
      embeds: [
        buildInfoEmbed({
          title: 'Configurazione mancante',
          description:
            'Nessun URL prodotto impostato. Imposta `DEFAULT_PRODUCT_URL` nel `.env` ' +
            'oppure usa `/config_bici url <link>` (solo proprietario).',
          color: 'error',
        }),
      ],
    });
    return;
  }

  // Marca subito (cooldown parte dall'inizio del controllo).
  markUsed(interaction.user.id, 'check_bici');

  // Risposta differita: il doppio controllo puo richiedere ~25-35s.
  await interaction.deferReply();

  // Aggiorna l'utente con un messaggio intermedio (visibile a tutti).
  await interaction.editReply({
    embeds: [
      buildInfoEmbed({
        title: 'Controllo in corso',
        description:
          `Sto controllando **${config.expectedName || 'la bici'}**.\n` +
          `Eseguo un doppio controllo (~${Math.round(DOUBLE_CHECK_WAIT_MS / 1000)}s di pausa) per evitare falsi positivi...`,
        color: 'info',
      }),
    ],
  });

  let result;
  try {
    result = await performDoubleCheck(config, DOUBLE_CHECK_WAIT_MS);
  } catch (err) {
    result = {
      status: 'error',
      errorMessage: err?.message || String(err),
      name: config.expectedName,
      url: config.url,
      variant: config.variant,
    };
  }

  // Salva nel DB lo stato attuale.
  try {
    db.saveCheck({
      status: result.status,
      name: result.name,
      price: result.price,
      url: result.url || config.url,
      variant: result.variant || config.variant,
      raw: { reasons: result.reasons, doubleChecked: result.doubleChecked },
    });
  } catch {
    // non bloccare la risposta per un errore di scrittura
  }

  await interaction.editReply({
    embeds: [buildCheckEmbed(result, { triggeredBy: interaction.user.username })],
  });
}

module.exports = { data, execute };
