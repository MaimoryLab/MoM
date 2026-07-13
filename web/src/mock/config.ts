// Initial Settings page state. In production this would come from
// GET /api/config; preview build just seeds a local useState.

export type AdvisorSlot = { id: string; model: string };
export type PricingRow  = { model: string; input: number; output: number };

export type MockConfig = {
  provider: {
    baseUrl: string;
    authStyle: 'bearer' | 'x-api-key';
    keyMasked: string;
  };
  aggregator: { model: string };
  advisors: AdvisorSlot[];
  judge: { model: string };
  baseline: { model: string; enabled: boolean };
  pricing: PricingRow[];
};

export const initialConfig: MockConfig = {
  provider: {
    baseUrl: 'https://api.deepseek.com',
    authStyle: 'bearer',
    keyMasked: 'dee****k7yq',
  },
  aggregator: { model: 'claude-sonnet-4-6' },
  advisors: [
    { id: 'A', model: 'kimi-k2' },
    { id: 'B', model: 'deepseek-v3' },
    { id: 'C', model: 'qwen3-72b' },
  ],
  judge: { model: 'claude-sonnet-4-6' },
  baseline: { model: 'claude-fable-5', enabled: true },
  pricing: [
    { model: 'claude-sonnet-4-6', input:  3.00, output: 15.00 },
    { model: 'claude-fable-5',    input: 15.00, output: 75.00 },
    { model: 'claude-haiku-4-5',  input:  0.80, output:  4.00 },
    { model: 'kimi-k2',           input:  0.15, output:  0.60 },
    { model: 'deepseek-v3',       input:  0.27, output:  1.10 },
    { model: 'qwen3-72b',         input:  0.20, output:  0.80 },
  ],
};

// Options for model dropdowns (union of pricing + a few extras).
export const modelOptions: string[] = [
  'claude-sonnet-4-6',
  'claude-fable-5',
  'claude-haiku-4-5',
  'claude-opus-4-8',
  'kimi-k2',
  'deepseek-v3',
  'deepseek-r1',
  'qwen3-72b',
  'qwen3-32b',
  'gpt-5',
  'gpt-5-mini',
];
