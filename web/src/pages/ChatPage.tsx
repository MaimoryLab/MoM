// Chat — the compose surface for MoM.
//
// Same LiveJobProvider Context as LivePage, but the layout puts Composer on
// top with recent-runs dropdown next to it, then the comparison view below
// (MoM vs Baseline + Judge/Cost). No ranking chart — that lives on Live Compare.

import { useEffect, useState } from 'react';
import { PageShell } from '../components/layout/PageShell';
import { Button } from '../components/primitives/Button';
import { useI18n } from '../i18n/context';
import { space } from '../theme';
import { useLiveJob } from '../hooks/useLiveRun';
import { navigateTo } from '../App';
import {
  getPresets, listComparisons,
  type ComparisonListItem, type PresetEntry,
} from '../lib/api';
import {
  BaselineColumn, Composer, CostCard, JudgeCard, MomColumn, RunSelect, StatusStrip,
} from './live-shared';

export function ChatPage() {
  const { t, lang } = useI18n();
  const [prompt, setPrompt] = useState('');
  const [baselineOn, setBaselineOn] = useState(true);
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

  useEffect(() => {
    let cancelled = false;
    listComparisons(20)
      .then((res) => { if (!cancelled) setJobs(res.items); })
      .catch((err) => { if (!cancelled) setJobsError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [live.current?.gateway_request_id, live.current?.status]);

  const busy = live.polling;

  const submit = (text: string) => {
    const p = text.trim();
    if (!p || busy) return;
    live.submit({ prompt: p, baseline_on: baselineOn, lang });
  };
  const onSubmit = () => submit(prompt);
  const onPreset = (preset: PresetEntry) => {
    const text = lang === 'zh' ? preset.zh : preset.en;
    setPrompt(text);
    submit(text);
  };

  const current = live.current;
  const currentGw = current?.gateway_request_id ?? null;

  return (
    <PageShell
      title={t.chat.title}
      subtitle={t.chat.subtitle}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: space.md, flexWrap: 'wrap' }}>
          <RunSelect
            value={currentGw}
            items={jobs}
            error={jobsError}
            onChange={(gw) => live.select(gw)}
            label={t.chat.historyLabel}
            placeholder={t.chat.historyPlaceholder}
            emptyLabel={t.chat.historyEmpty}
          />
        </div>
        <Composer
          prompt={prompt}
          onPromptChange={setPrompt}
          onSubmit={onSubmit}
          baselineOn={baselineOn}
          onBaselineToggle={setBaselineOn}
          presets={presets}
          presetsError={presetsError}
          onPreset={onPreset}
          busy={busy}
        />
        <StatusStrip live={current} polling={live.polling} transportError={live.transportError} />
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
    </PageShell>
  );
}
