export interface DetailHeaderProps {
  tone: 'go' | 'due' | 'closing' | 'awaiting';
  /** e.g. "closing — posted 24 days ago". */
  eyebrow: string;
  title: string;
  /** e.g. "Portkey · Remote, India · posted role · ashby feed". */
  subtitle: string;
}

/** The opened job's header: accent + eyebrow status line, title, subtitle. */
export function DetailHeader({ tone, eyebrow, title, subtitle }: DetailHeaderProps) {
  return (
    <div data-palette="v2" className="dhead">
      <div className="dhead-eb">
        <i className={`bar ${tone}`} />
        <span className={`eb ${tone}`}>{eyebrow}</span>
      </div>
      <h1>{title}</h1>
      <div className="sub">{subtitle}</div>
    </div>
  );
}
