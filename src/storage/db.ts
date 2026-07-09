import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let db: Database.Database | null = null;

export function initDB(path: string): Database.Database {
  const instance = new Database(path);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  const schemaPath = join(dirname(fileURLToPath(import.meta.url)), 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf8');
  instance.exec(schema);
  db = instance;
  return instance;
}

export function getDB(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized — call initDB() first');
  }
  return db;
}

export function closeDB(): void {
  if (db) {
    db.close();
    db = null;
  }
}
