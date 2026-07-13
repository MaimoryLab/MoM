import { useState } from 'react';
import { PageShell } from '../components/layout/PageShell';
import { Card } from '../components/primitives/Card';
import { Badge } from '../components/primitives/Badge';
import { Button } from '../components/primitives/Button';
import { useI18n } from '../i18n/context';
import { initialConfig, modelOptions, type MockConfig } from '../mock/config';
import { color, radius, space } from '../theme';

export function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const [cfg, setCfg] = useState<MockConfig>(initialConfig);
  const [savedFlash, setSavedFlash] = useState(false);

  const onSave = () => {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1600);
  };

  return (
    <PageShell
      title={t.settings.title}
      subtitle={t.settings.subtitle}
      actions={
        <>
          <Button variant="ghost" onClick={() => setCfg(initialConfig)}>{t.settings.cancelButton}</Button>
          <Button variant="primary" onClick={onSave}>{t.settings.saveButton}</Button>
        </>
      }
    >
      {savedFlash && (
        <div style={{ padding: space.sm, background: '#E4EFE0', border: `1px solid ${color.positive}`, borderRadius: radius.md, color: color.positive, fontSize: 13 }}>
          ✓ {t.settings.saved}
        </div>
      )}

      <Card title={t.settings.section.language} subtitle={t.settings.language.description}>
        <div style={{ display: 'flex', gap: space.sm }}>
          <RadioBtn active={lang === 'en'} onClick={() => setLang('en')}>{t.settings.language.option.en}</RadioBtn>
          <RadioBtn active={lang === 'zh'} onClick={() => setLang('zh')}>{t.settings.language.option.zh}</RadioBtn>
        </div>
      </Card>

      <Card title={t.settings.section.provider} subtitle={t.settings.provider.hint}>
        <FieldGrid>
          <Field label={t.settings.provider.baseUrl}>
            <ReadOnly value={cfg.provider.baseUrl} />
          </Field>
          <Field label={t.settings.provider.auth}>
            <ReadOnly value={`${cfg.provider.authStyle} · ${cfg.provider.keyMasked}`} />
          </Field>
        </FieldGrid>
      </Card>

      <Card title={t.settings.section.aggregator}>
        <FieldGrid>
          <Field label={t.settings.aggregator.model}>
            <Select
              value={cfg.aggregator.model}
              options={modelOptions}
              onChange={(v) => setCfg({ ...cfg, aggregator: { model: v } })}
            />
          </Field>
        </FieldGrid>
      </Card>

      <Card
        title={t.settings.section.advisors}
        actions={
          <Button
            variant="secondary"
            onClick={() => setCfg({ ...cfg, advisors: [...cfg.advisors, { id: String.fromCharCode(65 + cfg.advisors.length), model: modelOptions[0] }] })}
          >
            + {t.settings.advisor.add}
          </Button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
          {cfg.advisors.map((slot, idx) => (
            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 100px', gap: space.md, alignItems: 'center' }}>
              <Badge tone="neutral">{t.settings.advisor.slot} {slot.id}</Badge>
              <Select
                value={slot.model}
                options={modelOptions}
                onChange={(v) => {
                  const advisors = [...cfg.advisors];
                  advisors[idx] = { ...slot, model: v };
                  setCfg({ ...cfg, advisors });
                }}
              />
              <Button
                variant="ghost"
                onClick={() => setCfg({ ...cfg, advisors: cfg.advisors.filter((_, i) => i !== idx) })}
              >
                × {t.settings.advisor.remove}
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card title={t.settings.section.judge}>
        <FieldGrid>
          <Field label={t.settings.judge.judgeModel}>
            <Select value={cfg.judge.model} options={modelOptions}
              onChange={(v) => setCfg({ ...cfg, judge: { model: v } })} />
          </Field>
          <Field label={t.settings.judge.baselineModel}>
            <Select value={cfg.baseline.model} options={modelOptions}
              onChange={(v) => setCfg({ ...cfg, baseline: { ...cfg.baseline, model: v } })} />
          </Field>
        </FieldGrid>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: space.sm, fontSize: 13, color: color.textSecondary, cursor: 'pointer' }}>
          <input type="checkbox" checked={cfg.baseline.enabled}
            onChange={(e) => setCfg({ ...cfg, baseline: { ...cfg.baseline, enabled: e.target.checked } })} />
          {t.settings.judge.enable}
          <span style={{ color: color.textMuted, fontSize: 12 }}>· {t.settings.judge.enableHint}</span>
        </label>
      </Card>

      <Card title={t.settings.section.pricing}>
        <PricingTable cfg={cfg} setCfg={setCfg} />
      </Card>
    </PageShell>
  );
}

function FieldGrid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: space.md }}>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, color: color.textSecondary, letterSpacing: '0.04em' }}>{label}</span>
      {children}
    </label>
  );
}

function ReadOnly({ value }: { value: string }) {
  const { t } = useI18n();
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: 36, padding: `0 ${space.md}`, background: color.bgSubtle,
        border: `1px solid ${color.border}`, borderRadius: radius.md,
        fontSize: 13, color: color.textMuted, fontFamily: 'ui-monospace, monospace',
      }}
    >
      <span>{value}</span>
      <Badge tone="neutral">🔒 {t.settings.provider.locked}</Badge>
    </div>
  );
}

function Select({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        appearance: 'none', height: 36, padding: `0 ${space.md}`,
        background: color.surface, border: `1px solid ${color.borderStrong}`,
        borderRadius: radius.md, fontSize: 13, color: color.textPrimary,
        fontFamily: 'ui-monospace, monospace', cursor: 'pointer',
      }}
    >
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function PricingTable({ cfg, setCfg }: { cfg: MockConfig; setCfg: (c: MockConfig) => void }) {
  const { t } = useI18n();
  const update = (idx: number, patch: Partial<MockConfig['pricing'][number]>) => {
    const pricing = cfg.pricing.map((row, i) => (i === idx ? { ...row, ...patch } : row));
    setCfg({ ...cfg, pricing });
  };
  return (
    <div style={{ border: `1px solid ${color.border}`, borderRadius: radius.md, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', background: color.bgSubtle, padding: `${space.sm} ${space.md}`, fontSize: 12, color: color.textSecondary, letterSpacing: '0.04em' }}>
        <span>{t.settings.pricing.model}</span>
        <span style={{ textAlign: 'right' }}>{t.settings.pricing.input}</span>
        <span style={{ textAlign: 'right' }}>{t.settings.pricing.output}</span>
      </div>
      {cfg.pricing.map((row, i) => (
        <div key={row.model} style={{
          display: 'grid', gridTemplateColumns: '2fr 1fr 1fr',
          padding: `${space.sm} ${space.md}`, alignItems: 'center',
          borderTop: `1px solid ${color.border}`, gap: space.md,
        }}>
          <code style={{ fontSize: 13, color: color.textPrimary, fontFamily: 'ui-monospace, monospace' }}>{row.model}</code>
          <NumInput value={row.input}  onChange={(v) => update(i, { input: v })} />
          <NumInput value={row.output} onChange={(v) => update(i, { output: v })} />
        </div>
      ))}
    </div>
  );
}

function NumInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={value}
      step={0.01}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      style={{
        appearance: 'none', height: 32, padding: `0 ${space.sm}`,
        background: color.surface, border: `1px solid ${color.border}`,
        borderRadius: radius.sm, fontSize: 13, color: color.textPrimary,
        fontFamily: 'ui-monospace, monospace', textAlign: 'right', width: '100%',
      }}
    />
  );
}

function RadioBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        appearance: 'none',
        border: `1.5px solid ${active ? color.mom : color.border}`,
        background: active ? color.momSoft : color.surface,
        color: active ? color.mom : color.textPrimary,
        padding: '10px 20px', borderRadius: radius.md, fontSize: 14, cursor: 'pointer',
        fontWeight: active ? 500 : 400, transition: 'all 120ms ease',
      }}
    >
      {children}
    </button>
  );
}
