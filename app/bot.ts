import * as ccxt from 'ccxt';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
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
const generateTradeId = (
  userId: string,
  channelId: string,
  symbol: string,
  direction: 'long' | 'short'
) => `${userId}-${channelId}-${symbol}-${direction}`;

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
      await (interaction as ButtonInteraction).deferReply({ ephemeral: true });
    } else if (
      interaction.isButton() &&
      ['bitget', 'bybit', 'mexc'].includes(interaction.customId)
    ) {
      // Defer exchange button (ephemeral reply needed)
      await (interaction as ButtonInteraction).deferReply({ ephemeral: true });
    }
    // Note: Do NOT defer for direction selection buttons (long, short)
    // because showModal() will handle the response immediately
  } catch (error) {
    console.error('Failed to defer interaction:', error);
    return; // Exit if deferral fails
  }

  // Handle /trade command
  if (interaction.isCommand() && interaction.commandName === 'trade') {
    const action = (
      interaction.options as CommandInteractionOptionResolver
    ).getString('action') as 'create' | 'edit';

    if (action === 'edit') {
      const userTrades = getActiveTrades().filter(
        (t) =>
          t.userId === interaction.user.id &&
          t.channelId === interaction.channelId
      );

      if (userTrades.length === 0) {
        await interaction.editReply({
          content: 'No active trades found to edit.',
        });
        return;
      }

      const buttons = userTrades.map((trade) =>
        new ButtonBuilder()
          .setCustomId(`edit_${trade.tradeId}`)
          .setLabel(
            `${trade.ticker} ${trade.direction.toUpperCase()} on ${
              trade.exchange
            }`
          )
          .setStyle(ButtonStyle.Primary)
      );

      const rows: ActionRowBuilder<ButtonBuilder>[] = [];
      for (let i = 0; i < buttons.length; i += 5) {
        rows.push(
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            ...buttons.slice(i, i + 5)
          )
        );
      }

      await interaction.editReply({
        content: 'Select the trade you want to edit:',
        components: rows,
      });
      return;
    }

    // Create buttons for exchange selection (for create flow)
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

  // Handle edit trade buttons
  if (interaction.isButton() && interaction.customId.startsWith('edit_')) {
    const buttonInteraction = interaction as ButtonInteraction;
    const tradeId = buttonInteraction.customId.replace('edit_', '');
    const trade = getTrade(tradeId);

    if (!trade) {
      await buttonInteraction.editReply({ content: 'Trade not found.' });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(
        `trade_modal_${trade.exchange}_${trade.direction}_${trade.tradeId}`
      )
      .setTitle(`Edit Trade ${trade.ticker} ${trade.direction.toUpperCase()}`);

    const inputs = [
      new TextInputBuilder()
        .setCustomId('ticker')
        .setLabel('Crypto Ticker')
        .setStyle(TextInputStyle.Short)
        .setValue(trade.ticker)
        .setRequired(true),
      new TextInputBuilder()
        .setCustomId('leverage')
        .setLabel('Leverage')
        .setStyle(TextInputStyle.Short)
        .setValue(trade.leverage.toString())
        .setRequired(true),
      new TextInputBuilder()
        .setCustomId('entryPrice')
        .setLabel('Entry Price')
        .setStyle(TextInputStyle.Short)
        .setValue(trade.entryPrice.toString())
        .setRequired(true),
      new TextInputBuilder()
        .setCustomId('stopLoss')
        .setLabel('Stop Loss')
        .setStyle(TextInputStyle.Short)
        .setValue(trade.stopLoss.toString())
        .setRequired(true),
      new TextInputBuilder()
        .setCustomId('takeProfit')
        .setLabel('Take Profit')
        .setStyle(TextInputStyle.Short)
        .setValue(trade.takeProfit.toString())
        .setRequired(true),
    ];

    modal.addComponents(
      inputs.map((input) =>
        new ActionRowBuilder<TextInputBuilder>().addComponents(input)
      )
    );

    await buttonInteraction.showModal(modal);
  }

  // Handle exchange selection buttons
  if (
    interaction.isButton() &&
    ['bitget', 'bybit', 'mexc'].includes(interaction.customId)
  ) {
    const buttonInteraction = interaction as ButtonInteraction;
    const exchange = buttonInteraction.customId;

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

    await buttonInteraction.editReply({
      content: `Select trade direction for ${exchange}:`,
      components: [row],
    });
  }

  if (interaction.isButton() && interaction.customId.startsWith('direction_')) {
    const buttonInteraction = interaction as ButtonInteraction;
    const [, dir, exchange] = buttonInteraction.customId.split('_');
    const direction = dir as 'long' | 'short';

    const modal = new ModalBuilder()
      .setCustomId(`trade_modal_${exchange}_${direction}`)
      .setTitle(`Enter Trade Details for ${exchange} ${direction}`);

    const inputs = [
      new TextInputBuilder()
        .setCustomId('ticker')
        .setLabel('Crypto Ticker (e.g., BTCUSDT)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true),
      new TextInputBuilder()
        .setCustomId('leverage')
        .setLabel('Leverage (e.g., 10)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true),
      new TextInputBuilder()
        .setCustomId('entryPrice')
        .setLabel('Your Entry Price')
        .setStyle(TextInputStyle.Short)
        .setRequired(true),
      new TextInputBuilder()
        .setCustomId('stopLoss')
        .setLabel('Stop Loss Price')
        .setStyle(TextInputStyle.Short)
        .setRequired(true),
      new TextInputBuilder()
        .setCustomId('takeProfit')
        .setLabel('Take Profit Price')
        .setStyle(TextInputStyle.Short)
        .setRequired(true),
    ];

    modal.addComponents(
      inputs.map((input) =>
        new ActionRowBuilder<TextInputBuilder>().addComponents(input)
      )
    );

    try {
      await buttonInteraction.showModal(modal);
    } catch (error) {
      console.error('Failed to show modal:', error);
      await buttonInteraction.editReply({
        content: 'Failed to show the modal. Please try again.',
      });
    }
  }

  // Handle modal submission
  if (
    interaction.isModalSubmit() &&
    interaction.customId.startsWith('trade_modal_')
  ) {
    const modalInteraction = interaction;
    const parts = modalInteraction.customId.split('_');
    const [, , exc, dir, existingTradeId] = parts;
    const exchange = exc as 'bitget' | 'bybit' | 'mexc';
    const direction = dir as 'long' | 'short';

    let trade = existingTradeId ? getTrade(existingTradeId) : undefined;
    if (!trade) {
      // New trade if no existing trade found
      trade = {
        tradeId: existingTradeId || '',
        userId: modalInteraction.user.id,
        channelId: modalInteraction.channelId ?? 'default-channel-id',
        closed: false,
      } as Trade;
    }

    const ticker = modalInteraction.fields
      .getTextInputValue('ticker')
      .toUpperCase();
    const leverage = parseFloat(
      modalInteraction.fields.getTextInputValue('leverage')
    );
    const entryPrice = parseFloat(
      modalInteraction.fields.getTextInputValue('entryPrice')
    );
    const stopLoss = parseFloat(
      modalInteraction.fields.getTextInputValue('stopLoss')
    );
    const takeProfit = parseFloat(
      modalInteraction.fields.getTextInputValue('takeProfit')
    );

    if (
      isNaN(leverage) ||
      isNaN(entryPrice) ||
      isNaN(stopLoss) ||
      isNaN(takeProfit)
    ) {
      await modalInteraction.editReply({
        content:
          'Invalid input. Please enter numeric values for leverage, entry price, stop loss, and take profit.',
      });
      return;
    }

    if (leverage <= 0 || entryPrice <= 0) {
      await modalInteraction.editReply({
        content: 'Leverage and Entry Price must be positive numbers.',
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
        await modalInteraction.editReply({
          content: 'Failed to fetch current price.',
        });
        return;
      }

      // Update trade fields from modal
      trade.ticker = ticker;
      trade.leverage = leverage;
      trade.exchange = exchange;
      trade.direction = direction;
      trade.entryPrice = entryPrice;
      trade.stopLoss = stopLoss;
      trade.takeProfit = takeProfit;

      // Update tradeId to reflect symbol/direction
      trade.tradeId = generateTradeId(
        modalInteraction.user.id,
        modalInteraction.channelId ?? 'default-channel-id',
        trade.ticker,
        trade.direction
      );

      saveTrade(trade);

      const { embeds, components } = createTradeEmbed(
        trade,
        currentPrice,
        false
      ); // Not closed yet

      let message;
      try {
        if (trade.messageId) {
          // Update existing message if it exists
          const channel = client.channels.cache.get(trade.channelId) as
            | TextChannel
            | DMChannel
            | undefined;
          if (channel) {
            message = await channel.messages.fetch(trade.messageId);
            await message.edit({ embeds, components });
          }
        } else {
          // Send new message
          message = await (
            modalInteraction.channel as TextChannel | DMChannel
          )?.send({
            embeds,
            components,
          });
        }
      } catch (error) {
        console.error('Failed to send or update message:', error);
        await modalInteraction.editReply({
          content:
            'Trade saved, but failed to send or update the trade message. Check bot permissions.',
        });
        return;
      }

      if (message) {
        // Store the message ID and update the trade in the database
        trade.messageId = message.id;
        updateTrade(trade);
        await modalInteraction.editReply({
          content: existingTradeId
            ? 'Trade updated successfully!'
            : 'Trade created successfully with your specified entry price! I will update the status periodically.',
        });
      } else {
        await modalInteraction.editReply({
          content:
            'Trade saved, but failed to send the Discord message. Check bot permissions.',
        });
      }
    } catch (error) {
      console.error('Error in modal submission:', error);
      await modalInteraction.editReply({
        content:
          'Error creating or updating trade. The exchange API may be slow or ticker is invalid.',
      });
    }
  }

  // Handle close position
  if (interaction.isButton() && interaction.customId.startsWith('close_')) {
    const buttonInteraction = interaction as ButtonInteraction;
    const tradeId = buttonInteraction.customId.replace('close_', '');
    const trade = getTrade(tradeId);

    if (!trade || trade.closed) {
      await buttonInteraction.editReply({
        content: 'No active trade found or trade already closed.',
      });
      return;
    }

    // Check if user is a moderator
    const member = buttonInteraction.member;
    if (
      !member ||
      !('permissions' in member) ||
      !(member.permissions instanceof PermissionsBitField) ||
      !member.permissions.has(PermissionsBitField.Flags.ManageRoles)
    ) {
      await buttonInteraction.editReply({
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
        await buttonInteraction.editReply({
          content: 'Failed to fetch current price to close the trade.',
        });
        return;
      }

      const roe = calculateROE(
        trade.entryPrice,
        closePrice,
        trade.leverage,
        trade.direction
      );

      trade.closed = true;
      trade.closePrice = closePrice;
      updateTrade(trade);

      // Create closed trade embed
      const { embeds } = createTradeEmbed(trade, closePrice, true);

      try {
        const message = await buttonInteraction.channel?.messages.fetch(
          trade.messageId!
        );
        await message?.edit({ embeds, components: [] });
      } catch (error) {
        console.error('Failed to edit trade message:', error);
        await buttonInteraction.editReply({
          content:
            'Trade closed, but failed to update the message. Check bot permissions.',
        });
        return;
      }

      await buttonInteraction.editReply({
        content: 'Trade closed successfully!',
      });
    } catch (error) {
      console.error('Error closing trade:', error);
      await buttonInteraction.editReply({
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
