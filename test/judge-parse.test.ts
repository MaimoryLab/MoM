import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseJudgeCompare } from '../src/judge/judge-parse.js';

const VALID = {
  response_a: { correctness: 90, completeness: 85, depth: 80, clarity: 88, usefulness: 92 },
  response_b: { correctness: 70, completeness: 65, depth: 60, clarity: 72, usefulness: 68 },
  verdict_summary: 'Response A is clearly stronger on correctness.',
};

describe('parseJudgeCompare', () => {
  it('strict JSON parse — no fallback', () => {
    const out = parseJudgeCompare(JSON.stringify(VALID));
    assert.ok(out);
    assert.equal(out!.fallback, false);
    assert.equal(out!.a.correctness, 90);
    assert.equal(out!.b.correctness, 70);
    assert.equal(out!.verdict_summary, VALID.verdict_summary);
  });

  it('trims markdown code fences before parsing', () => {
    const wrapped = '```json\n' + JSON.stringify(VALID) + '\n```';
    const out = parseJudgeCompare(wrapped);
    assert.ok(out);
    assert.equal(out!.fallback, false);
  });

  it('regex-extract fallback when there is prose around the JSON', () => {
    const noisy = 'Here is my verdict:\n' + JSON.stringify(VALID) + '\nThanks!';
    const out = parseJudgeCompare(noisy);
    assert.ok(out);
    assert.equal(out!.fallback, true);
    assert.equal(out!.a.completeness, 85);
  });

  it('clamps out-of-range scores to [0,100]', () => {
    const wild = {
      response_a: { correctness: 150, completeness: 40, depth: 70, clarity: 60, usefulness: 55 },
      response_b: { correctness: -10, completeness: 40, depth: 70, clarity: 60, usefulness: 55 },
      verdict_summary: null,
    };
    const out = parseJudgeCompare(JSON.stringify(wild));
    assert.ok(out);
    assert.equal(out!.a.correctness, 100);
    assert.equal(out!.b.correctness, 0);
    assert.equal(out!.verdict_summary, null);
  });

  it('rounds fractional scores', () => {
    const frac = {
      response_a: { correctness: 87.4, completeness: 87.6, depth: 50, clarity: 50, usefulness: 50 },
      response_b: { correctness: 50, completeness: 50, depth: 50, clarity: 50, usefulness: 50 },
      verdict_summary: 'tie-ish',
    };
    const out = parseJudgeCompare(JSON.stringify(frac));
    assert.ok(out);
    assert.equal(out!.a.correctness, 87);
    assert.equal(out!.a.completeness, 88);
  });

  it('returns null when a required dimension is missing', () => {
    const bad = {
      response_a: { correctness: 90, completeness: 85, depth: 80, clarity: 88 }, // no usefulness
      response_b: VALID.response_b,
      verdict_summary: 'x',
    };
    const out = parseJudgeCompare(JSON.stringify(bad));
    assert.equal(out, null);
  });

  it('returns null when response_b is entirely missing', () => {
    const bad = { response_a: VALID.response_a, verdict_summary: 'x' };
    const out = parseJudgeCompare(JSON.stringify(bad));
    assert.equal(out, null);
  });

  it('returns null when the string does not contain any JSON object', () => {
    const out = parseJudgeCompare('the model refused to answer');
    assert.equal(out, null);
  });

  it('returns null on truncated / unparseable JSON', () => {
    const out = parseJudgeCompare('{"response_a": {"correctness":');
    assert.equal(out, null);
  });
});
