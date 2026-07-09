import { getDB } from './db.js';
import { DEFAULT_SETTINGS, type MoMSettings } from '../types/mom.js';

interface SettingsRow {
  data: string;
}

export function loadSettings(): MoMSettings {
  const db = getDB();
  const row = db.prepare<[], SettingsRow>('SELECT data FROM settings WHERE id = 1').get();
  if (!row) {
    saveSettings(DEFAULT_SETTINGS);
    return structuredClone(DEFAULT_SETTINGS);
  }
  return JSON.parse(row.data) as MoMSettings;
}

export function saveSettings(settings: MoMSettings): void {
  const db = getDB();
  const data = JSON.stringify(settings);
  const now = Date.now();
  db.prepare(
    'INSERT INTO settings (id, data, updated_at) VALUES (1, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
  ).run(data, now);
}
