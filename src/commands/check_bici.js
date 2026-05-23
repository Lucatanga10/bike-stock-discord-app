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
  .setIntegrationTypes(ApplicationIntegrationType.UserInstall)
  .setContexts(InteractionContextType.BotDM, InteractionContextType.PrivateChannel);

/** Tronca una stringa per il messaggio Discord (evita di esporre stack/URL lunghi). */
function shortMsg(s, max = 180) {
  if (!s) return 'errore sconosciuto';
  const flat = String(s).replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

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

  markUsed(interaction.user.id, 'check_bici');
  await interaction.deferReply();

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
  let unexpectedError = null;
  try {
    result = await performDoubleCheck(config, DOUBLE_CHECK_WAIT_MS);
  } catch (err) {
    // Eccezione "imprevista": performDoubleCheck di solito non lancia, ma per
    // sicurezza la catturiamo qui e la trasformiamo in un result "error".
    unexpectedError = err;
    result = {
      status: 'error',
      errorName: err?.name || 'Error',
      errorMessage: err?.message || String(err),
      errorPhase: 'uncaught',
      errorStack: err?.stack || null,
      name: config.expectedName,
      url: config.url,
      variant: config.variant,
      reasons: [],
      signals: {},
    };
  }

  // === Logging completo lato server (Render logs) ===
  if (result.status === 'error') {
    // Log strutturato con TUTTI i dettagli utili al debug, ma SENZA segreti.
    console.error('[check_bici] errore controllo:', {
      url:        config.url,
      expectedName: config.expectedName || null,
      variant:    config.variant || null,
      errorName:  result.errorName,
      errorPhase: result.errorPhase,
      errorMessage: result.errorMessage,
      httpStatus: result.signals?.html?.httpStatus ?? null,
      pageTitle:  result.signals?.html?.pageTitle ?? null,
      cartButtonFound: result.signals?.html?.cartButtonFound ?? null,
      matchedOutWords: result.signals?.html?.matchedOutWords ?? [],
      reasons:    result.reasons,
    });
    if (result.errorStack) {
      // Stack su riga separata per leggerlo bene su Render.
      console.error('[check_bici] stack:\n' + result.errorStack);
    }
    if (unexpectedError) {
      console.error('[check_bici] eccezione raw:', unexpectedError);
    }
  } else {
    // Log breve anche per i casi non-errore (utile per audit).
    console.log(
      `[check_bici] verdetto=${result.status} name="${result.name || ''}" price=${result.price || 'N/D'} url=${config.url}`,
    );
  }

  // === Salva nel DB ===
  try {
    db.saveCheck({
      status:  result.status,
      name:    result.name,
      price:   result.price,
      url:     result.url || config.url,
      variant: result.variant || config.variant,
      raw: {
        reasons:      result.reasons,
        doubleChecked: result.doubleChecked,
        errorName:    result.errorName    || null,
        errorPhase:   result.errorPhase   || null,
        errorMessage: result.errorMessage || null,
      },
    });
  } catch (dbErr) {
    console.error('[check_bici] errore salvataggio DB:', dbErr?.message || dbErr);
  }

  // === Messaggio Discord: breve, senza dati sensibili ===
  if (result.status === 'error') {
    // Non mostrare stack/URL completi/segreti: solo phase + messaggio sintetico.
    result.errorMessage = `Errore controllo sito [${result.errorPhase || 'unknown'}]: ${shortMsg(result.errorMessage)}`;
  }

  await interaction.editReply({
    embeds: [buildCheckEmbed(result, { triggeredBy: interaction.user.username })],
  });
}

module.exports = { data, execute };
