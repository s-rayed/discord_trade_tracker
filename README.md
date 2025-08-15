## Discord Trade Tracker

---

A Discord bot for creating, managing, and tracking cryptocurrency trades across multiple exchanges (Binance, Bitget, Bybit, MEXC so far). The bot allows users to initiate trades, monitor their status, and close positions with real-time price updates and Return on Equity (ROE) calculations. It integrates with the CCXT library for exchange APIs and uses a database to store trade data.

### Features
- Slash Command Interface: Use the /trade command to create or edit trades.
- Exchange Support: Supports Binance, Bitget, Bybit, and MEXC for fetching real-time price data (so far).
- Trade Management: Set entry price, leverage, stop loss, and take profit for each trade.
- Real-Time Updates: Automatically updates active trades every 60 seconds (configurable) with current prices and ROE.
- Close Position: Moderators can close trades, updating the trade status with final ROE.
- Embed Notifications: Displays trade details in Discord embeds with dynamic color banners (green for positive ROE, yellow for negative, red for closed).
- Database Integration: Stores trade data persistently

### Requirements
- Node.js (v16 or higher)
- Discord.js (v14 or higher)
- CCXT (v4.4.80 or higher)
- dotenv for environment variable management
- Discord token with the following permissions:
  - Send Messages
  - Embed Links
  - Read Message History
  - Manage Messages (for closing trades)
- Optional API Keys for supported exchanges - to be set in the `.env` file

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/s-rayed/discord_trade_tracker.git
   cd discord_trade_tracker
  ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the root directory and add your Discord bot token and API keys for supported exchanges:
   ```env
   DISCORD_APPLICATION_ID=XXXXXXXXXX
   DISCORD_PUBLIC_KEY=XXXXXXXXXX
   DISCORD_BOT_TOKEN=XXXXXXX
   DISCORD_BOT_PERMISSIONS_INTEGER=XXXXXXXXXX
   ```
4. Run the bot:
   ```bash
   npm run start
   ```
5. Invite the bot to your server using the OAuth2 URL generated in the Discord Developer Portal with the required permissions.
6. Use the `/trade` command to create and manage trades.

### Usage
1. Invite the bot: Add the bot to your Discord server with the necessary permissions.
2. Create a trade:
  - Use `/trade` and select Create or `/trade action:create` to create a new trade.
  - Select an exchange via buttons.
  - Fill out the modal with trade details (entry price, leverage, stop loss, take profit).
  - The bot saves the trade in DB and posts an embed with trade details.
4. Edit a trade:
  - Use `/trade` and select Edit or `/trade action:edit` to edit an existing trade.
  - Select the trade.
  - Fill out the modal with updated trade details.
  - The bot updates the trade in DB and posts an updated embed with trade details.
5. Close a trade by clicking the close button in the embed:
  - The trade is marked as closed and the embed is updated with the final price and ROE.
6. Automatic updates:
  - The bot automatically updates active trades every 60 seconds (configurable) with current prices and ROE.
  - The embed is updated with the latest price and ROE.

### Configuration
- Update interval: Modify the `TRADER_UPDATE_INTERVAL_IN_SECONDS` variable to change how often active trades are updated (default is 60 seconds).
- API Timeout: Adjust `API_MAX_TIMEOUT` to set the maximum time for exchange API calls (default: 5 seconds).
- Environment Variables: Ensure all required environment variables are set in the `.env` file.

### Database Schema
The bot expects a `Trade` interface for db operations. The schema:
```typescript
export interface Trade {
  tradeId: string;
  ticker: string;
  leverage: number;
  exchange: 'bitget' | 'bybit' | 'mexc';
  stopLoss: number;
  takeProfit: number;
  entryPrice: number;
  userId: string;
  channelId: string;
  messageId?: string;
  closed: boolean;
  closePrice?: number;
}
```

### Contribution
- Pull request or just fork it and do what you want, I'm not your dad

### TODO:
- Gating to certain channels
- 

## License
This project is licensed under the GNU General Public License v3.0. See the [LICENSE](LICENSE) file for details.