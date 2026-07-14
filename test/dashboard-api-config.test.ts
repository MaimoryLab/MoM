import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  registerConfigAPI,
  maskApiKey,
  assertMoMConfigShape,
  ValidationError,
} from '../src/dashboard-api/config-api.js';
import { createOrchestratorHolder } from '../src/orchestrator/orchestrator-holder.js';
import { initDB, closeDB } from '../src/storage/db.js';
import { DEFAULT_MOM_CONFIG, type MoMConfig, type RuntimeConfig } from '../src/types/mom.js';

function baseMoM(): MoMConfig {
  return structuredClone(DEFAULT_MOM_CONFIG);
}

function validAlwaysMoM(): MoMConfig {
  const cfg = baseMoM();
  cfg.mom_mode = 'always';
  cfg.advisor.slots = ['adv-a', 'adv-b'];
  cfg.aggregator.model = 'agg-main';
  cfg.pricing_table = {
    'adv-a': { currency: 'USD', input: 1, output: 2, cache_write: 1, cache_read: 0.1 },
  };
  return cfg;
}

let tmpDir: string;
let momConfigPath: string;
let runtime: RuntimeConfig;
let app: FastifyInstance;

before(async () => {
  initDB(':memory:');
  tmpDir = mkdtempSync(join(tmpdir(), 'mom-config-api-'));
  momConfigPath = join(tmpDir, 'mom.config.json');
  writeFileSync(momConfigPath, JSON.stringify(baseMoM()), 'utf8');
});
after(async () => {
  closeDB();
  rmSync(tmpDir, { recursive: true, force: true });
});
beforeEach(() => {
  writeFileSync(momConfigPath, JSON.stringify(baseMoM()), 'utf8');
});

async function buildApp(startingMoM: MoMConfig = baseMoM()): Promise<FastifyInstance> {
  runtime = {
    provider: {
      base_url: 'https://api.example.com/v1',
      api_key: 'sk-1234567890abcdef',
      auth_style: 'bearer',
    },
    mom: structuredClone(startingMoM),
    mom_config_source: 'mom.config.json@initial',
  };
  const holder = createOrchestratorHolder(runtime);
  const instance = Fastify({ logger: false });
  registerConfigAPI(instance, { runtime, momConfigPath, holder });
  await instance.ready();
  return instance;
}

describe('maskApiKey', () => {
  it('masks a long key as <3>****<2>', () => {
    assert.equal(maskApiKey('sk-1234567890abcdef'), 'sk-****ef');
  });
  it('handles short keys without leaking length', () => {
    assert.equal(maskApiKey('abc'), 'a****');
  });
  it('handles empty key', () => {
    assert.equal(maskApiKey(''), '');
  });
});

describe('assertMoMConfigShape', () => {
  it('accepts DEFAULT_MOM_CONFIG', () => {
    assertMoMConfigShape(baseMoM());
  });
  it('rejects wrong mom_mode', () => {
    const cfg: any = baseMoM();
    cfg.mom_mode = 'sometimes';
    assert.throws(() => assertMoMConfigShape(cfg), ValidationError);
  });
  it('rejects non-string advisor slot', () => {
    const cfg: any = baseMoM();
    cfg.advisor.slots = ['adv-a', 42];
    assert.throws(() => assertMoMConfigShape(cfg), ValidationError);
  });
  it('rejects pricing_table entry missing "cache_write"', () => {
    const cfg: any = baseMoM();
    cfg.pricing_table = {
      'model-x': { currency: 'USD', input: 1, output: 2, cache_read: 0.1 },
    };
    assert.throws(() => assertMoMConfigShape(cfg), ValidationError);
  });
});

describe('GET /api/config', () => {
  it('200 with masked provider + full mom + source pointer', async () => {
    app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/config' });
      assert.equal(res.statusCode, 200);
      const body = res.json() as any;
      assert.equal(body.provider.api_key_masked, 'sk-****ef');
      assert.equal(body.provider.base_url, 'https://api.example.com/v1');
      assert.equal(body.provider.auth_style, 'bearer');
      assert.ok(!('api_key' in body.provider));
      assert.equal(body.mom.mom_mode, 'off');
      assert.equal(body.mom_config_source, 'mom.config.json@initial');
    } finally {
      await app.close();
    }
  });
});

describe('POST /api/config', () => {
  it('200 saves to disk, mutates runtime, rebuilds orchestrator', async () => {
    app = await buildApp();
    let rebuildCount = 0;
    // Wire a spy on holder via a fresh instance to observe rebuild
    // (buildApp already wired one — bypass by hijacking runtime + swapping holder)
    // The public spec we assert instead: response body + on-disk contents + runtime.mom.
    try {
      const desired = validAlwaysMoM();
      const res = await app.inject({
        method: 'POST',
        url: '/api/config',
        payload: { mom: desired },
        headers: { 'content-type': 'application/json' },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json() as any;
      assert.equal(body.mom.mom_mode, 'always');
      assert.deepEqual(body.mom.advisor.slots, ['adv-a', 'adv-b']);
      assert.match(
        body.mom_config_source,
        /^mom\.config\.json@\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
      // On-disk should now match
      const persisted = JSON.parse(readFileSync(momConfigPath, 'utf8'));
      assert.equal(persisted.mom_mode, 'always');
      // Runtime should reflect the new config
      assert.equal(runtime.mom.mom_mode, 'always');
      assert.equal(runtime.mom_config_source, body.mom_config_source);
      void rebuildCount;
    } finally {
      await app.close();
    }
  });

  it('rebuild() is invoked (orchestrator instance changes after save)', async () => {
    // Independent test that observes holder.rebuild by comparing get() identity
    runtime = {
      provider: {
        base_url: 'https://api.example.com/v1',
        api_key: 'sk-1234',
        auth_style: 'bearer',
      },
      mom: baseMoM(),
      mom_config_source: 'mom.config.json@initial',
    };
    const holder = createOrchestratorHolder(runtime);
    const before = holder.get();
    const instance = Fastify({ logger: false });
    registerConfigAPI(instance, { runtime, momConfigPath, holder });
    await instance.ready();
    try {
      const res = await instance.inject({
        method: 'POST',
        url: '/api/config',
        payload: { mom: validAlwaysMoM() },
      });
      assert.equal(res.statusCode, 200);
      const after = holder.get();
      assert.notEqual(before, after, 'orchestrator instance must be rebuilt');
    } finally {
      await instance.close();
    }
  });

  it('400 when body is not an object', async () => {
    app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/config',
        payload: 'not-json',
        headers: { 'content-type': 'text/plain' },
      });
      assert.equal(res.statusCode, 400);
    } finally {
      await app.close();
    }
  });

  it('400 when mom shape invalid', async () => {
    app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/config',
        payload: { mom: { mom_mode: 'sometimes' } },
        headers: { 'content-type': 'application/json' },
      });
      assert.equal(res.statusCode, 400);
      const body = res.json() as any;
      assert.equal(body.error.type, 'invalid_request_error');
    } finally {
      await app.close();
    }
  });

  it('400 when assertModeRequirements fails (always + empty slots)', async () => {
    app = await buildApp();
    try {
      const bad = baseMoM();
      bad.mom_mode = 'always';
      bad.advisor.slots = [];
      bad.aggregator.model = ''; // also empty, still fails
      const res = await app.inject({
        method: 'POST',
        url: '/api/config',
        payload: { mom: bad },
      });
      assert.equal(res.statusCode, 400);
      const body = res.json() as any;
      assert.equal(body.error.type, 'config_error');
    } finally {
      await app.close();
    }
  });

  it('ignores provider field in request body (no field-level rejection)', async () => {
    app = await buildApp();
    try {
      const desired = validAlwaysMoM();
      const res = await app.inject({
        method: 'POST',
        url: '/api/config',
        payload: {
          mom: desired,
          provider: { api_key: 'evil-key' },
        },
      });
      assert.equal(res.statusCode, 200);
      // Runtime provider unchanged
      assert.equal(runtime.provider.api_key, 'sk-1234567890abcdef');
    } finally {
      await app.close();
    }
  });
});
