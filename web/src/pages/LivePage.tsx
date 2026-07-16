// Live Compare — single-page workflow.
//
// Compose surface (prompt + presets + submit) lives here, so does the
// side-by-side viewer for MoM vs Baseline plus judge + cost. Post-ISS-049
// the standalone Chat page was folded in: a sticky composer sits at the
// bottom of the page and the preset shelf renders in the empty state
// only. Judge/cost/pipeline-jump still live below the two output columns.

import { useEffect, useState } from 'react';
import { PageShell } from '../components/layout/PageShell';
import { Button } from '../components/primitives/Button';
import { useI18n } from '../i18n/context';
import { color, space } from '../theme';
import { useLiveJob } from '../hooks/useLiveRun';
import { navigateTo } from '../App';
import {
  getPresets, listComparisons,
  type ComparisonListItem, type PresetEntry,
} from '../lib/api';
import {
  BaselineColumn, ComposerBar, CostCard, JudgeCard, MomColumn,
  PresetsList, RunSelect, StatusStrip,
} from './live-shared';

export function LivePage() {
  const { t, lang } = useI18n();
  const [prompt, setPrompt] = useState('');
  const [presets, setPresets] = useState<PresetEntry[]>([]);
  const [presetsError, setPresetsError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<ComparisonListItem[]>([]);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const live = useLiveJob();

  useEffect(() => {
    let cancelled = false;
    getPresets()
      .then((res) => { if (!cancelled) setPresets(res.presets); })
      .catch((err) => { if (!cancelled) setPresetsError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, []);

  // Only refetch history when a run *finishes* or the user selects a different
  // gateway_request_id — intermediate polling ticks don't change list contents
  // and would just cause the dropdown to redraw every 3 s.
  const historyKey = live.current
    ? `${live.current.gateway_request_id}:${live.current.status === 'judge_done' || live.current.status === 'error' ? live.current.status : 'active'}`
    : null;
  useEffect(() => {
    let cancelled = false;
    listComparisons(20)
      .then((res) => { if (!cancelled) setJobs(res.items); })
      .catch((err) => { if (!cancelled) setJobsError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [historyKey]);

  const current = live.current;
  const currentGw = current?.gateway_request_id ?? null;
  const busy = live.polling;

  const submit = (text: string) => {
    const p = text.trim();
    if (!p || busy) return;
    live.submit({ prompt: p, baseline_on: true, lang });
    setPrompt('');
  };
  const onPreset = (preset: PresetEntry) => {
    submit(lang === 'zh' ? preset.zh : preset.en);
  };

  // Empty state = no run currently displayed and none loading. We show the
  // status strip, empty MoM/Baseline cards (fixed height, model labels blank),
  // judge/cost placeholders, and the preset list above the sticky composer.
  const isEmpty = current == null && !busy;

  return (
    <PageShell
      title={t.nav.live}
      subtitle={lang === 'zh'
        ? 'MoM 输出 vs Baseline 输出'
        : 'MoM output vs Baseline output'}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: space.md, paddingBottom: 140 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: space.md, flexWrap: 'wrap' }}>
          <RunSelect
            value={currentGw}
            items={jobs}
            error={jobsError}
            onChange={(gw) => live.select(gw)}
            label={t.live.recentRunsLabel}
            placeholder={t.live.recentRunsPlaceholder}
            emptyLabel={t.live.recentRunsEmpty}
            onNew={{ label: t.live.newRun, onClick: () => live.reset() }}
          />
        </div>
        <hr style={{ border: 0, borderTop: `1px solid ${color.border}`, margin: 0 }} />
        <StatusStrip live={current} polling={live.polling} transportError={live.transportError} />
        <hr style={{ border: 0, borderTop: `1px solid ${color.border}`, margin: 0 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: space.md }}>
          <MomColumn snap={current} />
          <BaselineColumn snap={current} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space.md }}>
          <JudgeCard snap={current} />
          <CostCard snap={current} />
        </div>
        {current && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => navigateTo('pipeline', current.gateway_request_id)}>
              {t.live.viewPipeline} →
            </Button>
          </div>
        )}
      </div>
      <ComposerBar
        prompt={prompt}
        onPromptChange={setPrompt}
        onSubmit={() => submit(prompt)}
        busy={busy}
        presetsSlot={isEmpty ? (
          <PresetsList presets={presets} presetsError={presetsError} onPreset={onPreset} busy={busy} />
        ) : null}
      />
    </PageShell>
  );
}
