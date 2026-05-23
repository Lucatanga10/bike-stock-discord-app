// /debug_bici - controllo SINGOLO con dump completo dei segnali raccolti.
// Riservato a OWNER_DISCORD_ID. Utile per investigare falsi negativi / errori.

const {
  SlashCommandBuilder,
  ApplicationIntegrationType,
  InteractionContextType,
} = require('discord.js');

const { performSingleCheck } = require('../services/bikeChecker');
const { buildInfoEmbed }      = require('../utils/formatMessage');
const { loadEffectiveConfig } = require('../utils/loadConfig');

const data = new SlashCommandBuilder()
  .setName('debug_bici')
  .setDescription('Diagnostica controllo bici (solo proprietario).')
  .setIntegrationTypes(ApplicationIntegrationType.UserInstall)
  .setContexts(InteractionContextType.BotDM, InteractionContextType.PrivateChannel);

/** Tronca un valore per stare nei limiti dei field Discord (1024 char). */
function fit(value, max = 1000) {
  if (value === null || value === undefined || value === '') return '—';
  const s = String(value);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
function yn(v) {
  if (v === true)  return 'si';
  if (v === false) return 'no';
  return '—';
}

async function execute(interaction) {
  const ownerId = process.env.OWNER_DISCORD_ID;
  if (!ownerId || interaction.user.id !== ownerId) {
    await interaction.reply({
      embeds: [
        buildInfoEmbed({
          title: 'Accesso negato',
          description: 'Solo il proprietario dell\'app puo usare /debug_bici.',
          color: 'error',
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
          description: 'Nessun URL prodotto impostato. Imposta `DEFAULT_PRODUCT_URL` o usa `/config_bici url`.',
          color: 'error',
        }),
      ],
    });
    return;
  }

  await interaction.deferReply();
  await interaction.editReply({
    embeds: [
      buildInfoEmbed({
        title: 'Debug in corso',
        description: `Eseguo un controllo singolo (senza doppio controllo) per raccogliere i segnali...`,
        color: 'info',
      }),
    ],
  });

  let result;
  try {
    result = await performSingleCheck(config);
  } catch (err) {
    console.error('[debug_bici] eccezione imprevista:', err);
    result = {
      status: 'error',
      errorName: err?.name || 'Error',
      errorMessage: err?.message || String(err),
      errorPhase: 'uncaught',
      errorStack: err?.stack || null,
      reasons: [],
      signals: {},
    };
  }

  // Log lato server (come check_bici)
  console.log('[debug_bici] dump:', {
    url: config.url,
    expectedName: config.expectedName,
    status: result.status,
    errorPhase:   result.errorPhase   || null,
    errorMessage: result.errorMessage || null,
    signals: result.signals,
    reasons:  result.reasons,
  });

  const html    = result.signals?.html    || {};
  const shopify = result.signals?.shopify || {};

  // Verdetto finale = ultima reason (di solito "Voti: ... -> verdict" o messaggio errore)
  const lastReason = Array.isArray(result.reasons) && result.reasons.length
    ? result.reasons[result.reasons.length - 1]
    : '—';

  const fields = [
    { name: 'URL prodotto',          value: fit(config.url) },
    { name: 'Nome prodotto atteso',  value: fit(config.expectedName) },
    { name: 'Variante configurata',  value: fit(config.variant) },
    { name: 'Pagina caricata',       value: yn(html.ok),                          inline: true },
    { name: 'HTTP status',           value: fit(html.httpStatus),                 inline: true },
    { name: 'Titolo pagina',         value: fit(html.pageTitle) },
    { name: 'H1 trovato',            value: fit(html.h1Text) },
    { name: 'Bottone carrello trovato', value: yn(html.cartButtonFound),         inline: true },
    { name: 'Bottone enabled',       value: yn(html.cartButtonEnabled),           inline: true },
    { name: 'Testo bottone',         value: fit(html.cartButtonText),             inline: true },
    { name: 'Selettore CSS usato',   value: fit(config.cartSelector || '(default)') },
    { name: 'Parole "fuori scorta" trovate', value: fit((html.matchedOutWords || []).join(', ')) },
    { name: 'Parole "disponibile" trovate',  value: fit((html.matchedInWords  || []).join(', ')) },
    { name: 'JSON-LD availability',  value: fit(html.jsonLdAvailability) },
    { name: 'JSON-LD price',         value: fit(html.jsonLdPrice),                inline: true },
    { name: 'JSON-LD name',          value: fit(html.jsonLdName),                 inline: true },
    { name: 'Shopify .js ok',        value: yn(shopify.ok),                       inline: true },
    { name: 'Shopify HTTP status',   value: fit(shopify.statusCode),              inline: true },
    { name: 'Shopify available',     value: fit(shopify.data?.available),         inline: true },
    { name: 'Verdetto finale',       value: fit(result.status) },
    { name: 'Motivo finale',         value: fit(lastReason) },
  ];

  if (result.status === 'error') {
    fields.push(
      { name: 'Error phase',   value: fit(result.errorPhase),   inline: true },
      { name: 'Error name',    value: fit(result.errorName),    inline: true },
      { name: 'Error message', value: fit(result.errorMessage) },
    );
  }

  const colorByStatus = {
    available:    'available',
    out_of_stock: 'out',
    uncertain:    'uncertain',
    error:        'error',
  };

  await interaction.editReply({
    embeds: [
      buildInfoEmbed({
        title: 'Diagnostica /debug_bici',
        description: 'Dump completo dei segnali raccolti durante un controllo singolo. Lo stack completo dell\'errore (se presente) e\' nei log del server.',
        color: colorByStatus[result.status] || 'info',
        fields,
      }),
    ],
  });
}

module.exports = { data, execute };
