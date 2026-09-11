export interface FitReachMeterProps {
  /** The combined rank shown large: fit^0.65 * reach^0.35 * confidence. */
  score: number;
  fit: number;
  reach: number;
  /** Colour for the score figure and the fit bar — usually the channel colour. */
  accentColor?: string;
}

/** The two axes, never collapsed: fit (channel-coloured) and reachability (always grey). */
export function FitReachMeter({ score, fit, reach, accentColor = 'var(--signal)' }: FitReachMeterProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div className="mono" style={{ fontSize: 19, color: accentColor, lineHeight: 1 }}>{score}</div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 210 }}>
        <div className="jaxis">
          <span className="k">fit</span>
          <span className="bar" style={{ flex: 1 }}><i style={{ width: `${fit}%`, background: accentColor }} /></span>
          <span className="v num">{fit}</span>
        </div>
        <div className="jaxis">
          <span className="k">reach</span>
          <span className="bar" style={{ flex: 1 }}><i style={{ width: `${reach}%`, background: 'var(--neutral)' }} /></span>
          <span className="v num">{reach}</span>
        </div>
      </div>
    </div>
  );
}
