// /stato_bici - mostra l'ultimo stato salvato nel DB senza rifare il controllo.

const {
  SlashCommandBuilder,
  ApplicationIntegrationType,
  InteractionContextType,
} = require('discord.js');

const db = require('../services/database');
const { buildCheckEmbed, buildInfoEmbed } = require('../utils/formatMessage');

const data = new SlashCommandBuilder()
  .setName('stato_bici')
  .setDescription("Mostra l'ultimo stato salvato (senza rifare il controllo).")
  .setIntegrationTypes(ApplicationIntegrationType.UserInstall)
  .setContexts(InteractionContextType.BotDM, InteractionContextType.PrivateChannel);

async function execute(interaction) {
  const last = db.getLastCheck();
  if (!last) {
    await interaction.reply({
      embeds: [
        buildInfoEmbed({
          title: 'Nessun controllo precedente',
          description: 'Non ci sono ancora controlli salvati. Usa `/check_bici` per il primo.',
          color: 'info',
        }),
      ],
    });
    return;
  }

  const result = {
    status: last.status,
    name: last.name,
    price: last.price,
    url: last.url,
    variant: last.variant,
    ts: last.ts,
  };

  await interaction.reply({
    embeds: [buildCheckEmbed(result, { triggeredBy: interaction.user.username })],
  });
}

module.exports = { data, execute };
