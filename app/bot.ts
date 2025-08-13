import * as ccxt from 'ccxt';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  CommandInteractionOptionResolver,
  DMChannel,
  EmbedBuilder,
  ModalBuilder,
  PermissionsBitField,
  SlashCommandBuilder,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import * as dotenv from 'dotenv';
import {
  Trade,
  getActiveTrades,
  getTrade,
  saveTrade,
  updateTrade,
} from './database';

dotenv.config();

const TRADER_UPDATE_INTERVAL_IN_SECONDS = 60; // 1 minute
const API_MAX_TIMEOUT = 5000; // 5 seconds

// Initialize Discord client
const client = new Client({
  intents: ['Guilds', 'GuildMessages', 'GuildMembers', 'MessageContent'],
});
// extend ccxt with exchange classes
ccxt.exchanges['binance'] = ccxt.binance;
ccxt.exchanges['bitget'] = ccxt.bitget;
ccxt.exchanges['bybit'] = ccxt.bybit;
ccxt.exchanges['mexc'] = ccxt.mexc;

// Initialize exchange APIs
const exchanges = {
  binance: new ccxt.binance({
    apiKey: process.env.BINANCE_API_KEY,
    secret: process.env.BINANCE_API_SECRET,
  }),
  bitget: new ccxt.bitget({
    apiKey: process.env.BITGET_API_KEY,
    secret: process.env.BITGET_API_SECRET,
  }),
  bybit: new ccxt.bybit({
    apiKey: process.env.BYBIT_API_KEY,
    secret: process.env.BYBIT_API_SECRET,
  }),
  mexc: new ccxt.mexc({
    apiKey: process.env.MEXC_API_KEY,
    secret: process.env.MEXC_API_SECRET,
  }),
};

// Utility to generate trade ID
const generateTradeId = (userId: string, channelId: string) =>
  `${userId}-${channelId}`;

// Utility to calculate ROE
const calculateROE = (
  entryPrice: number,
  currentPrice: number,
  leverage: number,
  direction: 'long' | 'short'
) => {
  const priceChange =
    direction === 'long'
      ? (currentPrice - entryPrice) / entryPrice
      : (entryPrice - currentPrice) / entryPrice;
  return priceChange * leverage * 100;
};

// Slash command
const tradeCommand = new SlashCommandBuilder()
  .setName('trade')
  .setDescription('Create or edit a trade')
  .addStringOption((option) =>
    option
      .setName('action')
      .setDescription('Create or edit a trade')
      .setRequired(true)
      .addChoices(
        { name: 'Create', value: 'create' },
        { name: 'Edit', value: 'edit' }
      )
  );

client.once('ready', () => {
  console.log(`Logged in as ${client.user?.tag}`);
  client.application?.commands.create(tradeCommand);

  // Start the update interval after the bot is ready
  setInterval(updateActiveTrades, TRADER_UPDATE_INTERVAL_IN_SECONDS * 1000); // Update every 60 seconds (1 minute)
});

client.on('interactionCreate', async (interaction) => {
  console.log('Interaction received:', interaction.type, interaction.id);
  if (
    !interaction.isCommand() &&
    !interaction.isButton() &&
    !interaction.isModalSubmit()
  ) {
    return;
  }

  try {
    if (interaction.isCommand() || interaction.isModalSubmit()) {
      // Defer commands and modal submissions with ephemeral reply
      await interaction.deferReply({ ephemeral: true });
    } else if (
      interaction.isButton() &&
      interaction.customId.startsWith('close_')
    ) {
      // Defer close button (ephemeral reply needed)
      await interaction.deferReply({ ephemeral: true });
    } else if (
      interaction.isButton() &&
      ['bitget', 'bybit', 'mexc'].includes(interaction.customId)
    ) {
      // Defer exchange button (ephemeral reply needed)
      await interaction.deferReply({ ephemeral: true });
    }
    // Note: Do NOT defer for direction selection buttons (long, short)
    // because showModal() will handle the response immediately
  } catch (error) {
    console.error('Failed to defer interaction:', error);
    return; // Exit if deferral fails
  }

  // Handle/trade command
  if (interaction.isCommand() && interaction.commandName === 'trade') {
    const action = (
      interaction.options as CommandInteractionOptionResolver
    ).getString('action') as 'create' | 'edit';
    const tradeId = generateTradeId(interaction.user.id, interaction.channelId);

    if (action === 'edit' && !getTrade(tradeId)) {
      await interaction.editReply({
        content: 'No active trade found to edit.',
      });
      return;
    }

    // Create buttons for exchange selection
    const buttons = [
      new ButtonBuilder()
        .setCustomId('bitget')
        .setLabel('Bitget')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('bybit')
        .setLabel('Bybit')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('mexc')
        .setLabel('MEXC')
        .setStyle(ButtonStyle.Primary),
    ];
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);

    await interaction.editReply({
      content: `Select the exchange for your ${
        action === 'create' ? 'new' : 'edited'
      } trade:`,
      components: [row],
    });
  }

  // Handle exchange selection buttons
  if (
    interaction.isButton() &&
    ['bitget', 'bybit', 'mexc'].includes(interaction.customId)
  ) {
    const exchange = interaction.customId;

    const directionButtons = [
      new ButtonBuilder()
        .setCustomId(`direction_long_${exchange}`)
        .setLabel('Long')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`direction_short_${exchange}`)
        .setLabel('Short')
        .setStyle(ButtonStyle.Danger),
    ];
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      directionButtons
    );

    await interaction.editReply({
      content: `Select trade direction for ${exchange}:`,
      components: [row],
    });
  }

  if (interaction.isButton() && interaction.customId.startsWith('direction_')) {
    const [, dir, exchange] = interaction.customId.split('_');
    const direction = dir as 'long' | 'short';

    const modal = new ModalBuilder()
      .setCustomId(`trade_modal_${exchange}_${direction}`)
      .setTitle(`Enter Trade Details for ${exchange} ${direction}`);

    const inputs = [
      new TextInputBuilder()
        .setCustomId('ticker')
        .setLabel('Crypto Ticker (e.g., BTCUSDT)')
        .setStyle(TextInputStyle.Short),
      new TextInputBuilder()
        .setCustomId('leverage')
        .setLabel('Leverage (e.g., 10)')
        .setStyle(TextInputStyle.Short),
      new TextInputBuilder()
        .setCustomId('entryPrice')
        .setLabel('Your Entry Price')
        .setStyle(TextInputStyle.Short),
      new TextInputBuilder()
        .setCustomId('stopLoss')
        .setLabel('Stop Loss Price')
        .setStyle(TextInputStyle.Short),
      new TextInputBuilder()
        .setCustomId('takeProfit')
        .setLabel('Take Profit Price')
        .setStyle(TextInputStyle.Short),
    ];

    modal.addComponents(
      inputs.map((input) =>
        new ActionRowBuilder<TextInputBuilder>().addComponents(input)
      )
    );

    try {
      await interaction.showModal(modal);
    } catch (error) {
      console.error('Failed to show modal:', error);
      await interaction.editReply({
        content: 'Failed to show the modal. Please try again.',
      });
    }
  }

  // Handle modal submission
  if (
    interaction.isModalSubmit() &&
    interaction.customId.startsWith('trade_modal_')
  ) {
    const [, , exc, dir] = interaction.customId.split('_');
    const exchange = exc as 'bitget' | 'bybit' | 'mexc';
    const direction = dir as 'long' | 'short';
    const ticker = interaction.fields.getTextInputValue('ticker').toUpperCase();
    const leverage = parseFloat(
      interaction.fields.getTextInputValue('leverage')
    );
    const entryPrice = parseFloat(
      interaction.fields.getTextInputValue('entryPrice')
    );
    const stopLoss = parseFloat(
      interaction.fields.getTextInputValue('stopLoss')
    );
    const takeProfit = parseFloat(
      interaction.fields.getTextInputValue('takeProfit')
    );

    if (
      isNaN(leverage) ||
      isNaN(entryPrice) ||
      isNaN(stopLoss) ||
      isNaN(takeProfit)
    ) {
      await interaction.editReply({
        content:
          'Invalid input. Please enter numeric values for leverage, stop loss, and take profit.',
      });
      return;
    }

    if (leverage <= 0 || entryPrice <= 0) {
      // --- Add check for positive values including entryPrice ---
      await interaction.editReply({
        content: 'Leverage, and Entry Price must be positive numbers.',
      });
      return;
    }

    try {
      // Fetch current price from selected exchange with timeout
      const tickerData = (await Promise.race([
        exchanges[exchange].fetchTicker(ticker),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('API timeout')), API_MAX_TIMEOUT)
        ),
      ])) as ccxt.Ticker;
      const currentPrice = tickerData.last;

      if (!currentPrice) {
        await interaction.editReply({
          content: 'Failed to fetch current price.',
        });
        return;
      }

      const tradeId = generateTradeId(
        interaction.user.id,
        interaction.channelId ?? 'default-channel-id'
      );
      const trade: Trade = {
        tradeId,
        ticker,
        leverage,
        exchange,
        direction,
        stopLoss,
        takeProfit,
        entryPrice: entryPrice ?? currentPrice ?? 0,
        userId: interaction.user.id,
        channelId: interaction.channelId ?? 'default-channel-id',
        closed: false,
      };

      saveTrade(trade);

      const { embeds, components } = createTradeEmbed(
        trade,
        currentPrice,
        false
      ); // Not closed yet

      let message;
      try {
        message = await (interaction.channel as TextChannel | DMChannel)?.send({
          embeds,
          components,
        });
      } catch (error) {
        console.error('Failed to send message:', error);
        await interaction.editReply({
          content:
            'Trade saved, but failed to send the trade message. Check bot permissions.',
        });
        return;
      }

      if (message) {
        // Store the message ID and update the trade in the database
        trade.messageId = message.id;
        updateTrade(trade);
        await interaction.editReply({
          content:
            'Trade created successfully with your specified entry price! I will update the status periodically.',
        });
      } else {
        await interaction.editReply({
          content:
            'Trade saved with your entry price, but failed to send the Discord message. Check bot permissions.',
        });
      }
    } catch (error) {
      console.error('Error in modal submission:', error);
      await interaction.editReply({
        content:
          'Error creating trade. The exchange API may be slow or ticker is invalid.',
      });
    }
  }

  // Handle close position
  if (interaction.isButton() && interaction.customId.startsWith('close_')) {
    const tradeId = interaction.customId.replace('close_', '');
    const trade = getTrade(tradeId);

    if (!trade || trade.closed) {
      await interaction.editReply({
        content: 'No active trade found or trade already closed.',
      });
      return;
    }

    // Check if user is a moderator
    const member = interaction.member;
    if (
      !member ||
      !('permissions' in member) ||
      !(member.permissions instanceof PermissionsBitField) ||
      !member.permissions.has(PermissionsBitField.Flags.ManageRoles)
    ) {
      await interaction.editReply({
        content: 'Only moderators can close positions.',
      });
      return;
    }

    try {
      // Fetch current price from the exchange with timeout
      const tickerData = (await Promise.race([
        exchanges[trade.exchange].fetchTicker(trade.ticker),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('API timeout')), API_MAX_TIMEOUT)
        ),
      ])) as ccxt.Ticker;
      const closePrice = tickerData.last;

      if (!closePrice) {
        await interaction.editReply({
          content: 'Failed to fetch current price to close the trade.',
        });
        return;
      }

      const roe = calculateROE(
        trade.entryPrice,
        closePrice ?? 0,
        trade.leverage,
        trade.direction
      );

      trade.closed = true;
      trade.closePrice = closePrice;
      updateTrade(trade);

      // Create closed trade embed
      const { embeds } = createTradeEmbed(trade, closePrice, true);

      try {
        const message = await interaction.channel?.messages.fetch(
          trade.messageId!
        );
        await message?.edit({ embeds, components: [] });
      } catch (error) {
        console.error('Failed to edit trade message:', error);
        await interaction.editReply({
          content:
            'Trade closed, but failed to update the message. Check bot permissions.',
        });
        return;
      }

      await interaction.editReply({
        content: 'Trade closed successfully!',
      });
    } catch (error) {
      console.error('Error closing trade:', error);
      await interaction.editReply({
        content: 'Error closing trade. The exchange API may be slow.',
      });
    }
  }
});

function capitalize(str: string) {
  if (str.length === 0) {
    return ''; // Handle empty strings
  }
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function createTradeEmbed(
  trade: Trade,
  currentPrice: number | undefined,
  isClosed: boolean = false
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const roe = calculateROE(
    trade.entryPrice,
    currentPrice ?? 0,
    trade.leverage,
    trade.direction
  ); // Use 0 if price is undefined

  const embed = new EmbedBuilder()
    .setTitle(
      `${capitalize(trade.direction)} Trade ${isClosed ? 'Closed' : 'Active'} `
    )
    .setDescription(`Trade details for <@${trade.userId}>`) // Use user mention
    .addFields(
      { name: 'Ticker', value: trade.ticker, inline: true },
      { name: 'Exchange', value: trade.exchange, inline: true },
      { name: 'Leverage', value: trade.leverage.toString(), inline: true },
      {
        name: 'Entry Price',
        value: trade.entryPrice.toString(),
        inline: true,
      },
      {
        name: isClosed ? 'Close Price' : 'Current Price',
        value: currentPrice?.toString() ?? (isClosed ? 'N/A' : 'Fetching...'), // Handle potential undefined price
        inline: true,
      },
      { name: 'Stop Loss', value: trade.stopLoss.toString(), inline: true },
      {
        name: 'Take Profit',
        value: trade.takeProfit.toString(),
        inline: true,
      },
      {
        name: isClosed ? 'Final ROE' : 'Current ROE',
        value: `${roe.toFixed(2)}%`,
        inline: true,
      },
      {
        name: 'Last Updated',
        value: `${new Date().toLocaleString('en-US', {
          timeZone: 'America/New_York',
        })} EST`,
        inline: true,
      }
    )
    .setColor(isClosed ? '#ff0000' : roe >= 0 ? '#00ff00' : '#ffff00'); // Red for closed, Green for positive ROE, Yellow for negative

  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (!isClosed) {
    // Add close position button if not closed
    const closeButton = new ButtonBuilder()
      .setCustomId(`close_${trade.tradeId}`)
      .setLabel('Close Position')
      .setStyle(ButtonStyle.Danger);
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(closeButton)
    );
  }

  return { embeds: [embed], components };
}

// Add this function after the utility functions

async function updateActiveTrades() {
  console.log('Running active trade update...');
  const activeTrades = getActiveTrades(); // Get trades not marked as closed

  for (const trade of activeTrades) {
    if (!trade.messageId) {
      console.error(
        `Trade ${trade.tradeId} does not have a message ID. Cannot update message. Setting to closed in DB.`
      );
      trade.closed = true; // Mark as closed if no message ID
      updateTrade(trade);
      continue; // Skip this trade if it doesn't have a message ID
    }
    try {
      // Fetch current price from the trade's exchange
      const tickerData = await exchanges[trade.exchange].fetchTicker(
        trade.ticker
      );
      const currentPrice = tickerData.last;

      if (!currentPrice) {
        console.warn(
          `Could not fetch price for ${trade.ticker} on ${trade.exchange} (Trade ID: ${trade.tradeId})`
        );
        continue; // Skip update for this trade this time
      }

      // Find the channel and message
      const channel = client.channels.cache.get(trade.channelId) as
        | TextChannel
        | DMChannel
        | undefined;

      if (!channel) {
        console.error(
          `Channel ${trade.channelId} not found for trade ${trade.tradeId}. Cannot update message.`
        );
        // Optional: Consider marking this trade as errored or closed if the channel is permanently gone
        continue;
      }

      let message;
      try {
        message = await channel.messages.fetch(trade.messageId!);
      } catch (fetchError) {
        console.error(
          `Message ${trade.messageId} not found in channel ${trade.channelId} for trade ${trade.tradeId}. Cannot update message.`,
          fetchError
        );
        // Optional: Consider marking this trade as errored or closed if the message is permanently gone
        continue;
      }

      // Create updated embed and components (include close button)
      const updatedContent = createTradeEmbed(trade, currentPrice, false); // Not closed, so include button

      // Edit the message
      await message.edit(updatedContent);
      console.log(`Updated trade ${trade.tradeId}`);
    } catch (error) {
      console.error(`Error updating trade ${trade.tradeId}:`, error);
      // Continue to the next trade even if one fails
    }
  }
  console.log('Active trade update finished.');
}

// Login to Discord
client.login(process.env.DISCORD_BOT_TOKEN);
