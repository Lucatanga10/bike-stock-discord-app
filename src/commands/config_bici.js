// /config_bici - riservato al proprietario (OWNER_DISCORD_ID).
// Permette di modificare a runtime URL, nome atteso, parole, selettore, variante.
// Le impostazioni sovrascrivono quelle del .env e sono usate da /check_bici.

const {
  SlashCommandBuilder,
  ApplicationIntegrationType,
  InteractionContextType,
} = require('discord.js');

const db = require('../services/database');
const { buildInfoEmbed } = require('../utils/formatMessage');
const { loadEffectiveConfig } = require('../utils/loadConfig');

const data = new SlashCommandBuilder()
  .setName('config_bici')
  .setDescription("Configura il monitor (solo proprietario).")
  .setIntegrationTypes(ApplicationIntegrationType.UserInstall)
  .setContexts(InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
  .addSubcommand((sc) =>
    sc.setName('show').setDescription('Mostra la configurazione attuale.'),
  )
  .addSubcommand((sc) =>
    sc
      .setName('url')
      .setDescription('Imposta URL pagina prodotto.')
      .addStringOption((o) =>
        o.setName('value').setDescription('URL completo (https://...)').setRequired(true),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName('name')
      .setDescription('Imposta nome prodotto atteso (per validare la pagina).')
      .addStringOption((o) =>
        o.setName('value').setDescription('Nome esatto o frammento').setRequired(true),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName('out_words')
      .setDescription('Parole "fuori scorta" (separate da virgola). Vuoto = default.')
      .addStringOption((o) =>
        o.setName('value').setDescription('Es: sold out, esaurito, non disponibile').setRequired(true),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName('in_words')
      .setDescription('Parole "disponibile" (separate da virgola). Vuoto = default.')
      .addStringOption((o) =>
        o.setName('value').setDescription('Es: add to cart, aggiungi al carrello').setRequired(true),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName('cart_selector')
      .setDescription('Selettore CSS del bottone Aggiungi al carrello.')
      .addStringOption((o) =>
        o.setName('value').setDescription('Es: button[name="add"]').setRequired(true),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName('variant')
      .setDescription('Variante / taglia / colore da monitorare (Shopify variant id o titolo).')
      .addStringOption((o) =>
        o.setName('value').setDescription('Es: Black/Blue o 54900102791553').setRequired(true),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName('reset')
      .setDescription("Reimposta una chiave (la prossima volta valgono i default da .env).")
      .addStringOption((o) =>
        o
          .setName('key')
          .setDescription('Quale chiave azzerare')
          .setRequired(true)
          .addChoices(
            { name: 'product_url',    value: 'product_url' },
            { name: 'product_name',   value: 'product_name' },
            { name: 'out_words',      value: 'out_words' },
            { name: 'in_words',       value: 'in_words' },
            { name: 'cart_selector',  value: 'cart_selector' },
            { name: 'variant',        value: 'variant' },
            { name: 'ALL',            value: 'all' },
          ),
      ),
  );

// Mappa subcommand -> chiave DB
const KEY_MAP = {
  url:            'product_url',
  name:           'product_name',
  out_words:      'out_words',
  in_words:       'in_words',
  cart_selector:  'cart_selector',
  variant:        'variant',
};

async function execute(interaction) {
  const ownerId = process.env.OWNER_DISCORD_ID;
  if (!ownerId) {
    await interaction.reply({
      embeds: [
        buildInfoEmbed({
          title: 'Configurazione mancante',
          description: '`OWNER_DISCORD_ID` non impostato nel `.env`. /config_bici e disabilitato.',
          color: 'error',
        }),
      ],
    });
    return;
  }
  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      embeds: [
        buildInfoEmbed({
          title: 'Accesso negato',
          description: 'Solo il proprietario dell\'app puo usare /config_bici.',
          color: 'error',
        }),
      ],
    });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'show') {
    const cfg = loadEffectiveConfig();
    await interaction.reply({
      embeds: [
        buildInfoEmbed({
          title: 'Configurazione attuale',
          color: 'info',
          fields: [
            { name: 'URL prodotto',          value: cfg.url || '—' },
            { name: 'Nome prodotto atteso',  value: cfg.expectedName || '—' },
            { name: 'Parole "fuori scorta"', value: cfg.outOfStockWords.join(', ') || '(default)' },
            { name: 'Parole "disponibile"',  value: cfg.inStockWords.join(', ')    || '(default)' },
            { name: 'Selettore CSS carrello',value: cfg.cartSelector  || '(default)' },
            { name: 'Variante',              value: cfg.variant       || '—' },
          ],
        }),
      ],
    });
    return;
  }

  if (sub === 'reset') {
    const key = interaction.options.getString('key', true);
    if (key === 'all') {
      for (const k of Object.values(KEY_MAP)) db.deleteConfig(k);
    } else {
      db.deleteConfig(key);
    }
    await interaction.reply({
      embeds: [
        buildInfoEmbed({
          title: 'Reset eseguito',
          description: key === 'all' ? 'Tutte le chiavi sono state azzerate.' : `Chiave \`${key}\` azzerata.`,
          color: 'info',
        }),
      ],
    });
    return;
  }

  const dbKey = KEY_MAP[sub];
  if (!dbKey) {
    await interaction.reply({
      embeds: [
        buildInfoEmbed({
          title: 'Subcommand sconosciuto',
          description: `Sub \`${sub}\` non gestito.`,
          color: 'error',
        }),
      ],
    });
    return;
  }

  let value = interaction.options.getString('value', true).trim();

  // Validazione URL leggera
  if (sub === 'url') {
    try {
      // eslint-disable-next-line no-new
      new URL(value);
    } catch {
      await interaction.reply({
        embeds: [
          buildInfoEmbed({
            title: 'URL non valido',
            description: 'Inserisci un URL completo, es. `https://www.collectivebikes.com/products/...`.',
            color: 'error',
          }),
        ],
      });
      return;
    }
  }

  db.setConfig(dbKey, value);
  await interaction.reply({
    embeds: [
      buildInfoEmbed({
        title: 'Configurazione aggiornata',
        description: `Salvato \`${dbKey}\` = \`${value}\`.`,
        color: 'info',
      }),
    ],
  });
}

module.exports = { data, execute };
