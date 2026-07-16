import type { CSSProperties } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { color, font, radius, space } from '../../theme';

interface Props {
  text: string;
  minHeight?: number;
  maxHeight?: number;
  /**
   * Fixed height in px — sets minHeight and maxHeight to the same value so
   * the box never grows or shrinks with content. Overrides minHeight/maxHeight.
   * Use this for side-by-side comparison views where two boxes must stay the
   * same size regardless of which one has content first.
   */
  height?: number;
  cursor?: 'mom' | 'baseline' | null;
  /**
   * When true, drop the outer chrome (border / bgSubtle / padding / max-height /
   * inner scroll) and render the markdown inline so the parent container
   * governs layout and scrolling. Used inside DiffModal — a bordered box inside
   * a scrolling modal would double-scroll.
   */
  flush?: boolean;
}

/**
 * Render LLM output as markdown with GFM (tables / task lists / strikethrough).
 * Streaming-friendly: safe to re-render on every mom_delta.
 * No raw HTML, no syntax highlighter (bundle size).
 */
export function MarkdownBody({ text, minHeight = 260, maxHeight = 420, height, cursor, flush = false }: Props) {
  const boxMin = height ?? minHeight;
  const boxMax = height ?? maxHeight;
  const wrapperStyle: CSSProperties = flush
    ? {
        margin: 0,
        fontSize: font.size.sm,
        lineHeight: 1.6,
        color: color.textPrimary,
        wordBreak: 'break-word',
      }
    : {
        margin: 0,
        background: color.bgSubtle,
        border: `1px solid ${color.border}`,
        borderRadius: radius.md,
        padding: space.md,
        fontSize: font.size.sm,
        lineHeight: 1.6,
        color: color.textPrimary,
        wordBreak: 'break-word',
        minHeight: boxMin,
        maxHeight: boxMax,
        overflow: 'auto',
      };
  return (
    <div style={wrapperStyle}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: (p) => <p style={{ margin: `0 0 ${space.sm} 0` }} {...p} />,
          h1: (p) => <h1 style={{ fontSize: font.size.lg, margin: `${space.md} 0 ${space.sm} 0`, fontWeight: font.weight.semibold }} {...p} />,
          h2: (p) => <h2 style={{ fontSize: font.size.md, margin: `${space.md} 0 ${space.sm} 0`, fontWeight: font.weight.semibold }} {...p} />,
          h3: (p) => <h3 style={{ fontSize: font.size.sm, margin: `${space.sm} 0`, fontWeight: font.weight.semibold, color: color.textSecondary }} {...p} />,
          ul: (p) => <ul style={{ margin: `0 0 ${space.sm} 0`, paddingLeft: space.lg }} {...p} />,
          ol: (p) => <ol style={{ margin: `0 0 ${space.sm} 0`, paddingLeft: space.lg }} {...p} />,
          li: (p) => <li style={{ marginBottom: 4 }} {...p} />,
          a: (p) => <a style={{ color: color.mom }} target="_blank" rel="noreferrer" {...p} />,
          strong: (p) => <strong style={{ fontWeight: font.weight.semibold }} {...p} />,
          em: (p) => <em style={{ fontStyle: 'italic' }} {...p} />,
          hr: () => <hr style={{ border: 0, borderTop: `1px solid ${color.border}`, margin: `${space.md} 0` }} />,
          code: ({ inline, children, ...rest }: any) =>
            inline ? (
              <code
                style={{
                  fontFamily: 'ui-monospace, "SF Mono", monospace',
                  fontSize: '0.92em',
                  background: color.surface,
                  padding: '1px 6px',
                  borderRadius: 4,
                  border: `1px solid ${color.border}`,
                }}
                {...rest}
              >
                {children}
              </code>
            ) : (
              <code style={{ fontFamily: 'ui-monospace, "SF Mono", monospace' }} {...rest}>
                {children}
              </code>
            ),
          pre: (p) => (
            <pre
              style={{
                margin: `0 0 ${space.sm} 0`,
                padding: space.sm,
                background: color.surface,
                border: `1px solid ${color.border}`,
                borderRadius: radius.sm,
                overflow: 'auto',
                fontSize: font.size.xs,
                lineHeight: 1.5,
              }}
              {...p}
            />
          ),
          blockquote: (p) => (
            <blockquote
              style={{
                margin: `0 0 ${space.sm} 0`,
                paddingLeft: space.md,
                borderLeft: `3px solid ${color.border}`,
                color: color.textSecondary,
              }}
              {...p}
            />
          ),
          table: (p) => (
            <div style={{ overflow: 'auto', marginBottom: space.sm }}>
              <table style={{ borderCollapse: 'collapse', fontSize: font.size.xs, width: '100%' }} {...p} />
            </div>
          ),
          th: (p) => <th style={{ border: `1px solid ${color.border}`, padding: '6px 10px', background: color.surface, textAlign: 'left', fontWeight: font.weight.medium }} {...p} />,
          td: (p) => <td style={{ border: `1px solid ${color.border}`, padding: '6px 10px' }} {...p} />,
        }}
      >
        {text}
      </ReactMarkdown>
      {cursor && (
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 18,
            background: cursor === 'mom' ? color.mom : color.flagship,
            marginLeft: 2,
            verticalAlign: 'text-bottom',
            animation: 'blink 1s steps(1) infinite',
          }}
        />
      )}
    </div>
  );
}
