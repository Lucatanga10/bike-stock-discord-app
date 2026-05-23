// Costruttori di embed Discord. Niente flag ephemeral: le risposte sono pubbliche.

const { EmbedBuilder } = require('discord.js');

const COLORS = {
  available:    0x2ecc71, // verde
  out:          0xe74c3c, // rosso
  uncertain:    0xf1c40f, // giallo
  error:        0x95a5a6, // grigio
  info:         0x5865f2, // blurple Discord
};

/** Formatta un Date come stringa locale italiana leggibile. */
function fmtTime(date = new Date()) {
  return date.toLocaleString('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

/** Embed per risultato di /check_bici (e /stato_bici). */
function buildCheckEmbed(result, { triggeredBy } = {}) {
  const ts = result.ts ? new Date(result.ts) : new Date();
  const time = fmtTime(ts);

  let color = COLORS.error;
  let title = 'Bici controllata';
  let statusLine = 'Errore controllo';

  switch (result.status) {
    case 'available':
      color = COLORS.available;
      title = 'BICI DISPONIBILE ORA';
      statusLine = 'Acquistabile';
      break;
    case 'out_of_stock':
      color = COLORS.out;
      title = 'Bici controllata';
      statusLine = 'Fuori scorta';
      break;
    case 'uncertain':
      color = COLORS.uncertain;
      title = 'Stato incerto';
      statusLine = 'Possibile cambio pagina/cache, riprova tra poco';
      break;
    case 'error':
    default:
      color = COLORS.error;
      title = 'Errore durante il controllo';
      statusLine = result.errorMessage || 'Errore sconosciuto';
      break;
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(
      { name: 'Stato',           value: statusLine, inline: false },
      { name: 'Nome',            value: result.name || 'N/D', inline: false },
      { name: 'Prezzo',          value: result.price ? String(result.price) : 'N/D', inline: true },
      { name: 'Variante',        value: result.variant || '—', inline: true },
      { name: 'Ultimo controllo', value: time, inline: false },
    );

  if (result.url) {
    embed.addFields({ name: result.status === 'available' ? 'Link acquisto' : 'Link', value: result.url });
  }

  if (triggeredBy) {
    embed.setFooter({ text: `Richiesto da ${triggeredBy}` });
  }

  return embed;
}

/** Embed generico informativo (per /config_bici, errori di permesso, ecc.). */
function buildInfoEmbed({ title, description, fields = [], color = 'info' }) {
  const embed = new EmbedBuilder()
    .setColor(COLORS[color] ?? COLORS.info)
    .setTitle(title);
  if (description) embed.setDescription(description);
  if (fields.length) embed.addFields(fields);
  return embed;
}

module.exports = {
  buildCheckEmbed,
  buildInfoEmbed,
  COLORS,
  fmtTime,
};
