import initSqlJs, { type Database } from 'sql.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite } from './security';
import type { ServerRecord } from '../shared/contracts';
export class Store {
  private db!: Database;
  constructor(private file: string) {}
  async init(wasm: string) {
    const SQL = await initSqlJs({ locateFile: () => wasm });
    this.db = new SQL.Database(await fs.readFile(this.file).catch(() => undefined));
    this.db.run(
      'CREATE TABLE IF NOT EXISTS servers (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
    );
    await this.flush();
  }
  all(): ServerRecord[] {
    const rows = this.db.exec('SELECT body FROM servers ORDER BY rowid DESC');
    return (rows[0]?.values ?? []).map((row) => ({
      ...JSON.parse(String(row[0])),
      status: 'stopped',
      installed: false,
    }));
  }
  async put(s: ServerRecord) {
    this.db.run('INSERT OR REPLACE INTO servers(id,body) VALUES (?,?)', [s.id, JSON.stringify(s)]);
    await this.flush();
  }
  getSetting(key: string) {
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key=?');
    try {
      stmt.bind([key]);
      return stmt.step() ? String(stmt.get()[0]) : undefined;
    } finally {
      stmt.free();
    }
  }
  async setting(key: string, value: string) {
    this.db.run('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)', [key, value]);
    await this.flush();
  }
  private async flush() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await atomicWrite(this.file, this.db.export());
  }
}
