import type { DatabaseSync } from 'node:sqlite';
import { getDB } from '../storage/db.js';
import type {
  ComparisonBaselineErrorRow,
  ComparisonBaselineRow,
  ComparisonJudgeErrorRow,
  ComparisonJudgeRow,
  ComparisonMomRow,
  ComparisonRecord,
  ComparisonStatus,
} from './live-types.js';

function db(): DatabaseSync {
  return getDB();
}

export interface CreateComparisonInput {
  gateway_request_id: string;
  session_id: string | null;
  lang: 'zh' | 'en';
  prompt_text: string;
}

export function createComparison(input: CreateComparisonInput): void {
  const now = Date.now();
  db().prepare(
    `INSERT INTO comparisons (
      gateway_request_id, session_id, lang, prompt_text,
      started_at, updated_at, status
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
  ).run(
    input.gateway_request_id,
    input.session_id,
    input.lang,
    input.prompt_text,
    now,
    now,
  );
}

export function updateComparisonMom(
  gwId: string,
  mom: ComparisonMomRow,
  nextStatus: ComparisonStatus,
): void {
  db().prepare(
    `UPDATE comparisons
       SET mom_text = ?, mom_finished_at = ?, mom_usage_json = ?, mom_cost_usd = ?,
           status = ?, updated_at = ?
     WHERE gateway_request_id = ?`,
  ).run(
    mom.text,
    mom.finished_at,
    JSON.stringify(mom.usage),
    mom.cost_usd,
    nextStatus,
    Date.now(),
    gwId,
  );
}

export function updateComparisonBaseline(
  gwId: string,
  baseline: ComparisonBaselineRow,
  nextStatus: ComparisonStatus,
): void {
  db().prepare(
    `UPDATE comparisons
       SET baseline_model = ?, baseline_text = ?, baseline_finished_at = ?,
           baseline_usage_json = ?, baseline_cost_usd = ?,
           status = ?, updated_at = ?
     WHERE gateway_request_id = ?`,
  ).run(
    baseline.model,
    baseline.text,
    baseline.finished_at,
    JSON.stringify(baseline.usage),
    baseline.cost_usd,
    nextStatus,
    Date.now(),
    gwId,
  );
}

export function updateComparisonBaselineError(
  gwId: string,
  err: ComparisonBaselineErrorRow,
  nextStatus: ComparisonStatus,
): void {
  db().prepare(
    `UPDATE comparisons
       SET baseline_error_json = ?, status = ?, updated_at = ?
     WHERE gateway_request_id = ?`,
  ).run(JSON.stringify(err), nextStatus, Date.now(), gwId);
}

export function updateComparisonJudge(
  gwId: string,
  judge: ComparisonJudgeRow,
  nextStatus: ComparisonStatus,
): void {
  db().prepare(
    `UPDATE comparisons
       SET judge_model = ?, judge_finished_at = ?, judge_scores_json = ?,
           judge_verdict = ?, judge_fallback = ?, judge_ab_mapping_json = ?,
           status = ?, updated_at = ?
     WHERE gateway_request_id = ?`,
  ).run(
    judge.model,
    judge.finished_at,
    JSON.stringify(judge.scores),
    judge.verdict_summary,
    judge.fallback ? 1 : 0,
    JSON.stringify(judge.ab_mapping),
    nextStatus,
    Date.now(),
    gwId,
  );
}

export function updateComparisonJudgeError(
  gwId: string,
  err: ComparisonJudgeErrorRow,
  nextStatus: ComparisonStatus,
): void {
  db().prepare(
    `UPDATE comparisons
       SET judge_error_json = ?, status = ?, updated_at = ?
     WHERE gateway_request_id = ?`,
  ).run(JSON.stringify(err), nextStatus, Date.now(), gwId);
}

interface ComparisonRow {
  gateway_request_id: string;
  session_id: string | null;
  lang: string;
  prompt_text: string;
  started_at: number;
  updated_at: number;
  status: string;
  mom_text: string | null;
  mom_finished_at: number | null;
  mom_usage_json: string | null;
  mom_cost_usd: number | null;
  baseline_model: string | null;
  baseline_text: string | null;
  baseline_finished_at: number | null;
  baseline_usage_json: string | null;
  baseline_cost_usd: number | null;
  baseline_error_json: string | null;
  judge_model: string | null;
  judge_finished_at: number | null;
  judge_scores_json: string | null;
  judge_verdict: string | null;
  judge_fallback: number | null;
  judge_ab_mapping_json: string | null;
  judge_error_json: string | null;
}

function deserialize(row: ComparisonRow): ComparisonRecord {
  const momUsage = row.mom_usage_json ? JSON.parse(row.mom_usage_json) : null;
  const mom: ComparisonMomRow | null =
    row.mom_text !== null && momUsage && row.mom_finished_at !== null
      ? {
          text: row.mom_text,
          usage: momUsage,
          cost_usd: row.mom_cost_usd,
          finished_at: row.mom_finished_at,
          latency_ms: row.mom_finished_at - row.started_at,
        }
      : null;

  const baselineUsage = row.baseline_usage_json
    ? JSON.parse(row.baseline_usage_json)
    : null;
  const baseline: ComparisonBaselineRow | null =
    row.baseline_model !== null &&
    row.baseline_text !== null &&
    baselineUsage &&
    row.baseline_finished_at !== null
      ? {
          model: row.baseline_model,
          text: row.baseline_text,
          usage: baselineUsage,
          cost_usd: row.baseline_cost_usd,
          finished_at: row.baseline_finished_at,
          latency_ms: row.baseline_finished_at - row.started_at,
        }
      : null;

  const baseline_error: ComparisonBaselineErrorRow | null = row.baseline_error_json
    ? JSON.parse(row.baseline_error_json)
    : null;

  const judgeScores = row.judge_scores_json
    ? JSON.parse(row.judge_scores_json)
    : null;
  const judgeMapping = row.judge_ab_mapping_json
    ? JSON.parse(row.judge_ab_mapping_json)
    : { A: 'mom', B: 'baseline' };
  const judge: ComparisonJudgeRow | null =
    row.judge_model !== null && judgeScores && row.judge_finished_at !== null
      ? {
          model: row.judge_model,
          scores: judgeScores,
          verdict_summary: row.judge_verdict,
          fallback: (row.judge_fallback ?? 0) === 1,
          ab_mapping: judgeMapping,
          finished_at: row.judge_finished_at,
        }
      : null;

  const judge_error: ComparisonJudgeErrorRow | null = row.judge_error_json
    ? JSON.parse(row.judge_error_json)
    : null;

  return {
    gateway_request_id: row.gateway_request_id,
    session_id: row.session_id,
    lang: row.lang === 'zh' ? 'zh' : 'en',
    prompt_text: row.prompt_text,
    started_at: row.started_at,
    updated_at: row.updated_at,
    status: row.status as ComparisonStatus,
    mom,
    baseline,
    baseline_error,
    judge,
    judge_error,
  };
}

export function getComparisonById(gwId: string): ComparisonRecord | null {
  const row = db()
    .prepare('SELECT * FROM comparisons WHERE gateway_request_id = ?')
    .get(gwId) as unknown as ComparisonRow | undefined;
  return row ? deserialize(row) : null;
}
