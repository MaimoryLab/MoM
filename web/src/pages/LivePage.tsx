// Live Compare — viewer-only demo dashboard.
//
// Post-ISS-036 the compose surface moved to ChatPage. This page is now a big
// side-by-side viewer that shows one comparison at a time (from
// LiveJobProvider state) plus a Rolling-Rank chart underneath. The audience
// sees prompt + MoM answer + baseline answer + judge verdict + cost delta,
// nothing to interact with except swapping which past run is being viewed.

import { useEffect, useState } from 'react';
import { PageShell } from '../components/layout/PageShell';
import { Card } from '../components/primitives/Card';
import { Button } from '../components/primitives/Button';
import { RankingChart } from '../components/charts/RankingChart';
import { useI18n } from '../i18n/context';
import { space } from '../theme';
import { useLiveJob } from '../hooks/useLiveRun';
import { navigateTo } from '../App';
import { listComparisons, type ComparisonListItem } from '../lib/api';
import {
  BaselineColumn, CostCard, JudgeCard, MomColumn, RunSelect, StatusStrip,
} from './live-shared';

export function LivePage() {
  const { t, lang } = useI18n();
  const [jobs, setJobs] = useState<ComparisonListItem[]>([]);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const live = useLiveJob();

  useEffect(() => {
    let cancelled = false;
    listComparisons(20)
      .then((res) => { if (!cancelled) setJobs(res.items); })
      .catch((err) => { if (!cancelled) setJobsError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [live.current?.gateway_request_id, live.current?.status]);

  const current = live.current;
  const currentGw = current?.gateway_request_id ?? null;

  return (
    <PageShell
      title={t.nav.live}
      subtitle={lang === 'zh'
        ? 'MoM 输出 vs Baseline 输出 · 展示模式（去"提问"页发送新问题）'
        : 'MoM output vs Baseline output. Viewer-only — head to Chat to submit a new question.'}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: space.md, flexWrap: 'wrap' }}>
          <RunSelect
            value={currentGw}
            items={jobs}
            error={jobsError}
            onChange={(gw) => live.select(gw)}
            label={t.live.recentRunsLabel}
            placeholder={t.live.recentRunsPlaceholder}
            emptyLabel={t.live.recentRunsEmpty}
            onNew={{ label: t.chat.newRun, onClick: () => navigateTo('chat') }}
          />
        </div>
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
        <Card title={t.live.rankingTitle} subtitle={t.live.rankingSubtitle}>
          <RankingChart seed={currentGw ?? 'preview'} />
        </Card>
      </div>
    </PageShell>
  );
}
