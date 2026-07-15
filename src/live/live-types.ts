import type { ComparisonStatus } from '../types/dashboard-api.js';
import type { JudgeScores, TraceUsage } from '../types/mom.js';

export type { ComparisonStatus };

export interface ComparisonMomRow {
  text: string;
  usage: TraceUsage;
  cost_usd: number | null;
  finished_at: number;
  latency_ms: number;
}

export interface ComparisonMomErrorRow {
  message: string;
}

export interface ComparisonBaselineRow {
  model: string;
  text: string;
  usage: TraceUsage;
  cost_usd: number | null;
  finished_at: number;
  latency_ms: number;
}

export interface ComparisonBaselineErrorRow {
  message: string;
}

export interface ComparisonJudgeRow {
  model: string;
  scores: { mom: JudgeScores; baseline: JudgeScores };
  verdict_summary: string | null;
  fallback: boolean;
  ab_mapping: { A: 'mom' | 'baseline'; B: 'mom' | 'baseline' };
  finished_at: number;
}

export interface ComparisonJudgeErrorRow {
  message: string;
}

export interface ComparisonRecord {
  gateway_request_id: string;
  session_id: string | null;
  lang: 'zh' | 'en';
  prompt_text: string;
  started_at: number;
  updated_at: number;
  status: ComparisonStatus;
  /** Advisor slot ids frozen at submit time. */
  advisors_snapshot: string[] | null;
  /** Aggregator model frozen at submit time. */
  aggregator_model: string | null;
  /** Baseline model frozen at submit time (may be null if baseline was off). */
  baseline_model_snapshot: string | null;
  mom: ComparisonMomRow | null;
  mom_error: ComparisonMomErrorRow | null;
  baseline: ComparisonBaselineRow | null;
  baseline_error: ComparisonBaselineErrorRow | null;
  judge: ComparisonJudgeRow | null;
  judge_error: ComparisonJudgeErrorRow | null;
}
