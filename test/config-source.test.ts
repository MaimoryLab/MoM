import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stampMoMConfigSource } from '../src/config.js';

describe('stampMoMConfigSource (regression: E)', () => {
  it('includes ISO mtime for existing config file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mom-cfg-'));
    const path = join(dir, 'mom.config.json');
    writeFileSync(path, '{}', 'utf8');
    // Pin mtime to a known instant so we can assert exact substring.
    const t = new Date('2026-07-11T00:00:00.000Z');
    utimesSync(path, t, t);
    const source = stampMoMConfigSource(path);
    assert.equal(source, 'mom.config.json@2026-07-11T00:00:00.000Z');
  });

  it('falls back to bare basename if stat fails', () => {
    const source = stampMoMConfigSource('/nonexistent/path/mom.config.json');
    assert.equal(source, 'mom.config.json');
  });
});
