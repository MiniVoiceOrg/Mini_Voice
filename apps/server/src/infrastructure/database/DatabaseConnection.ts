import fs from 'fs';
import path from 'path';
import { Logger } from '../logger/Logger';
import { IDatabaseDriver, SqlJsDriver } from './SqliteWrapper';

export class DatabaseConnection {
  private db: IDatabaseDriver;

  private constructor(db: IDatabaseDriver) {
    this.db = db;
  }

  public static async create(dbPath: string): Promise<DatabaseConnection> {
    const driver = await SqlJsDriver.create(dbPath);
    driver.pragma('journal_mode = WAL');
    driver.pragma('foreign_keys = ON');

    const conn = new DatabaseConnection(driver);
    conn.runMigrations();
    return conn;
  }

  public getDb(): IDatabaseDriver {
    return this.db;
  }

  private runMigrations(): void {
    // Migration table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);

    let migrationsDir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      migrationsDir = path.join(__dirname, '../../../src/infrastructure/database/migrations');
    }
    if (!fs.existsSync(migrationsDir)) {
      return;
    }

    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

    const applied = new Set(
      (this.db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]).map((r) => r.version)
    );

    for (const file of files) {
      if (!applied.has(file)) {
        Logger.info('DATABASE', `Applying migration ${file}`);
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        this.db.transaction(() => {
          this.db.exec(sql);
          this.db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(file, Date.now());
        })();
        Logger.info('DATABASE', `Migration ${file} applied successfully`);
      }
    }
  }

  public close(): void {
    this.db.close();
  }
}
