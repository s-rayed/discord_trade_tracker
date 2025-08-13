import Database, { Statement } from 'better-sqlite3';

// Interface for trade data
export interface Trade {
  tradeId: string;
  ticker: string;
  leverage: number;
  exchange: 'bitget' | 'bybit' | 'mexc';
  direction: 'long' | 'short';
  stopLoss: number;
  takeProfit: number;
  entryPrice: number;
  userId: string;
  channelId: string;
  messageId?: string;
  closed: boolean;
  closePrice?: number;
}

// Type for database row (matches SQLite table structure)
interface TradeRow {
  tradeId: string;
  ticker: string;
  leverage: number;
  exchange: string;
  direction: string;
  stopLoss: number;
  takeProfit: number;
  entryPrice: number;
  userId: string;
  channelId: string;
  messageId: string | null;
  closed: number;
  closePrice: number | null;
}

// Generic DatabaseClient for type-safe queries
class DatabaseClient<T> {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
  }

  // Initialize the database schema
  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trades (
        tradeId TEXT PRIMARY KEY,
        ticker TEXT NOT NULL,
        leverage REAL NOT NULL,
        exchange TEXT NOT NULL,
        direction TEXT NOT NULL,
        stopLoss REAL NOT NULL,
        takeProfit REAL NOT NULL,
        entryPrice REAL NOT NULL,
        userId TEXT NOT NULL,
        channelId TEXT NOT NULL,
        messageId TEXT,
        closed INTEGER NOT NULL DEFAULT 0,
        closePrice REAL
      )
    `);
  }

  // Prepare a statement with type-safe parameters
  prepare<Params extends unknown[]>(sql: string): TypedStatement<Params, T> {
    return new TypedStatement<Params, T>(this.db.prepare(sql));
  }
}

// Type-safe Statement wrapper
class TypedStatement<Params extends unknown[], Row> {
  private stmt: Statement;

  constructor(stmt: Statement) {
    this.stmt = stmt;
  }

  // Run a statement with parameters
  run(...params: Params): void {
    this.stmt.run(...params);
  }

  // Get a single row
  get(...params: Params): Row | undefined {
    return this.stmt.get(...params) as Row | undefined;
  }

  // Get multiple rows (for SELECT queries expected to return multiple rows)
  all(...params: Params): Row[] {
    return this.stmt.all(...params) as Row[];
  }
}

// Initialize database client
const dbClient = new DatabaseClient<TradeRow>('./database.sqlite');
dbClient.initialize();

// Helper to map a TradeRow to a Trade
const mapTradeRowToTrade = (row: TradeRow): Trade => ({
  tradeId: row.tradeId,
  ticker: row.ticker,
  leverage: row.leverage,
  exchange: row.exchange as 'bitget' | 'bybit' | 'mexc', // Cast back to union type
  direction: row.direction as 'long' | 'short',
  stopLoss: row.stopLoss,
  takeProfit: row.takeProfit,
  entryPrice: row.entryPrice,
  userId: row.userId,
  channelId: row.channelId,
  messageId: row.messageId ?? undefined, // Convert null to undefined
  closed: !!row.closed, // Convert 0/1 to boolean
  closePrice: row.closePrice ?? undefined, // Convert null to undefined
});

// Database operations
export const saveTrade = (trade: Trade): void => {
  const stmt = dbClient.prepare<
    [
      string,
      string,
      number,
      string,
      string,
      number,
      number,
      number,
      string,
      string,
      string | undefined,
      number,
      number | undefined
    ]
  >(`
    INSERT OR REPLACE INTO trades (
      tradeId, ticker, leverage, exchange, direction, stopLoss, takeProfit,
      entryPrice, userId, channelId, messageId, closed, closePrice
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    trade.tradeId,
    trade.ticker,
    trade.leverage,
    trade.exchange,
    trade.direction,
    trade.stopLoss,
    trade.takeProfit,
    trade.entryPrice,
    trade.userId,
    trade.channelId,
    trade.messageId ?? (null as any), // convert undefined to null for DB
    trade.closed ? 1 : 0,
    trade.closePrice ?? (null as any) // convert undefined to null for DB
  );
};

export const getTrade = (tradeId: string): Trade | undefined => {
  const stmt = dbClient.prepare<[string]>(
    'SELECT * FROM trades WHERE tradeId = ?'
  );
  const row = stmt.get(tradeId);

  if (!row) return undefined;

  return mapTradeRowToTrade(row);
};

// Function to get all active trades (closed = 0)
export const getActiveTrades = (): Trade[] => {
  const stmt = dbClient.prepare<[]>('SELECT * FROM trades WHERE closed = 0');
  const rows = stmt.all(); // Use the new .all() method

  return rows.map(mapTradeRowToTrade); // Map all rows using the helper
};

export const updateTrade = (trade: Trade): void => {
  const stmt = dbClient.prepare<
    [
      string,
      number,
      string,
      string,
      number,
      number,
      number,
      string,
      string,
      string | undefined,
      number,
      number | undefined,
      string
    ]
  >(`
    UPDATE trades SET
      ticker = ?, leverage = ?, exchange = ?, direction = ?, stopLoss = ?,
      takeProfit = ?, entryPrice = ?, userId = ?, channelId = ?,
      messageId = ?, closed = ?, closePrice = ?
    WHERE tradeId = ?
  `);

  stmt.run(
    trade.ticker,
    trade.leverage,
    trade.exchange,
    trade.direction,
    trade.stopLoss,
    trade.takeProfit,
    trade.entryPrice,
    trade.userId,
    trade.channelId,
    trade.messageId ?? (null as any),
    trade.closed ? 1 : 0,
    trade.closePrice ?? (null as any),
    trade.tradeId
  );
};
