import type { MouseEvent, ReactNode } from 'react';

export interface QueueRowFact {
  label: string;
  value: ReactNode;
  tone?: 'go' | 'due' | 'closing' | 'awaiting';
}

export interface QueueRowProps {
  /** The row's status accent — the bar on the left. At most one per row. */
  accentTone: 'go' | 'due' | 'closing' | 'awaiting' | 'neutral';
  rank: number | string;
  /** Whether the rank figure reads as good — a separate signal from the row's status accent. */
  rankTone?: 'go' | 'neutral';
  title: string;
  subtitle: string;
  /** Up to 2 label/value fact columns (e.g. "fit / reach", "posted · 4d ago"). */
  facts?: QueueRowFact[];
  actions?: ReactNode;
  /** Makes the whole row clickable: it lifts on hover and a click anywhere that isn't one of its own buttons or links calls this. */
  onOpen?: () => void;
}

/** A ruled queue row: accent bar, rank, title/company, up to 2 facts, actions. Score is never the row's accent. */
export function QueueRow({ accentTone, rank, rankTone = 'neutral', title, subtitle, facts, actions, onOpen }: QueueRowProps) {
  const click = onOpen
    ? (e: MouseEvent<HTMLDivElement>) => {
        if (!(e.target as HTMLElement).closest('button,a,input,select,textarea,label')) onOpen();
      }
    : undefined;
  return (
    <div data-palette="v2" className={`qrow ${accentTone}${onOpen ? ' clickable' : ''}`} onClick={click}>
      <i className={`bar ${accentTone}`} />
      <span className={`rank ${rankTone}`}>{rank}</span>
      <div className="main">
        <div className="t">{title}</div>
        <div className="s">{subtitle}</div>
      </div>
      {(facts ?? []).slice(0, 2).map((f, i) => (
        <div className="fact" key={i}>
          <div className="eb">{f.label}</div>
          <div className={`v ${f.tone ?? ''}`}>{f.value}</div>
        </div>
      ))}
      <div className="acts">{actions}</div>
    </div>
  );
}
