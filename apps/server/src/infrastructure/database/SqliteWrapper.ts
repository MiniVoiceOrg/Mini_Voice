import initSqlJs, { Database as SqlJsDatabase, Statement } from 'sql.js';
import fs from 'fs';
import path from 'path';

export interface IDatabaseDriver {
  prepare(sql: string): {
    get(...params: any[]): any;
    all(...params: any[]): any[];
    run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
  };
  exec(sql: string): void;
  transaction<T>(fn: () => T): () => T;
  pragma(pragmaStr: string): void;
  close(): void;
}

export class SqlJsDriver implements IDatabaseDriver {
  private db!: SqlJsDatabase;
  private dbPath: string;
  private inTransaction: number = 0;
  private isClosed: boolean = false;
  private dirty: boolean = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly SAVE_DEBOUNCE_MS = 3000;

  private constructor(dbPath: string, db: SqlJsDatabase) {
    this.dbPath = dbPath;
    this.db = db;
  }

  public static async create(dbPath: string): Promise<SqlJsDriver> {
    const SQL = await initSqlJs();
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let db: SqlJsDatabase;
    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath);
      db = new SQL.Database(fileBuffer);
    } else {
      db = new SQL.Database();
    }

    const driver = new SqlJsDriver(dbPath, db);
    // Ensure the file exists immediately on first creation.
    driver.flushToDisk();
    return driver;
  }

  /**
   * Marks the in-memory database as needing persistence and schedules a
   * debounced flush. This avoids exporting and rewriting the entire database
   * file on every single write, which is prohibitively expensive with sql.js.
   */
  private saveToDisk(): void {
    if (this.isClosed || this.inTransaction > 0) {
      return;
    }
    this.dirty = true;
    if (this.saveTimer === null) {
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this.flushToDisk();
      }, SqlJsDriver.SAVE_DEBOUNCE_MS);
    }
  }

  /** Synchronously exports the in-memory database to disk if dirty. */
  private flushToDisk(): void {
    if (this.isClosed) {
      return;
    }
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.dirty && fs.existsSync(this.dbPath)) {
      return;
    }
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
      this.dirty = false;
    } catch (e) {
      console.error('[DATABASE] Error persisting sqlite database to disk:', e);
    }
  }

  public prepare(sql: string) {
    const db = this.db;
    const self = this;

    return {
      get(...params: any[]): any {
        const stmt: Statement = db.prepare(sql);
        try {
          if (params.length > 0) {
            stmt.bind(params);
          }
          if (stmt.step()) {
            return stmt.getAsObject();
          }
          return undefined;
        } finally {
          stmt.free();
        }
      },

      all(...params: any[]): any[] {
        const stmt: Statement = db.prepare(sql);
        const results: any[] = [];
        try {
          if (params.length > 0) {
            stmt.bind(params);
          }
          while (stmt.step()) {
            results.push(stmt.getAsObject());
          }
          return results;
        } finally {
          stmt.free();
        }
      },

      run(...params: any[]) {
        const stmt: Statement = db.prepare(sql);
        try {
          if (params.length > 0) {
            stmt.bind(params);
          }
          stmt.step();
          self.saveToDisk();
          return {
            changes: db.getRowsModified(),
            lastInsertRowid: 0,
          };
        } finally {
          stmt.free();
        }
      },
    };
  }

  public exec(sql: string): void {
    this.db.exec(sql);
    this.saveToDisk();
  }

  public transaction<T>(fn: () => T): () => T {
    const self = this;
    return () => {
      self.inTransaction++;
      if (self.inTransaction === 1) {
        self.db.exec('BEGIN TRANSACTION;');
      }
      try {
        const result = fn();
        if (self.inTransaction === 1) {
          self.db.exec('COMMIT;');
        }
        return result;
      } catch (err) {
        if (self.inTransaction === 1) {
          try {
            self.db.exec('ROLLBACK;');
          } catch (e) {}
        }
        throw err;
      } finally {
        self.inTransaction--;
        if (self.inTransaction === 0) {
          self.saveToDisk();
        }
      }
    };
  }

  public pragma(pragmaStr: string): void {
    try {
      this.db.exec(`PRAGMA ${pragmaStr};`);
    } catch (e) {
      // Ignore unsupported pragmas in WASM
    }
  }

  public close(): void {
    if (this.isClosed) {
      return;
    }
    // Flush any pending debounced writes synchronously before closing.
    this.flushToDisk();
    this.isClosed = true;
    this.db.close();
  }
}
