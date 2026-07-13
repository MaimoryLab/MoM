import { cacheHitByModel } from '../../mock/cost';
import { color, font, radius } from '../../theme';

// Custom horizontal bars — recharts is overkill for a 4-row bar chart.

export function CacheHitBars() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '10px 0' }}>
      {cacheHitByModel.map((row) => (
        <div key={row.model} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: font.size.sm }}>
            <span style={{ color: color.textPrimary, fontWeight: font.weight.medium }}>{row.model}</span>
            <span style={{ color: color.textSecondary, fontFamily: 'ui-monospace, monospace' }}>
              {Math.round(row.rate * 100)}%
            </span>
          </div>
          <div
            style={{
              height: 12,
              background: color.gridLine,
              borderRadius: radius.sm,
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <div
              style={{
                width: `${row.rate * 100}%`,
                height: '100%',
                background: `linear-gradient(90deg, ${color.aggregatorOnly}, ${color.mom})`,
                borderRadius: radius.sm,
                transition: 'width 400ms ease',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
