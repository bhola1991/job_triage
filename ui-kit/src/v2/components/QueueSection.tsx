import type { ReactNode } from 'react';

export interface QueueSectionProps {
  title: string;
  count: number | string;
  tone?: 'go' | 'due' | 'closing' | 'awaiting';
  /** Right-aligned subtext, e.g. "sorted by rank". */
  note?: string;
  children: ReactNode;
}

/** One status bucket in the queue — a header (title, count, note) over its rows. */
export function QueueSection({ title, count, tone = 'go', note, children }: QueueSectionProps) {
  return (
    <div data-palette="v2" className="qsec">
      <div className={`qsec-head ${tone}`}>
        <span className="title">{title}</span>
        <span className="count">{count}</span>
        {note && <span className="note">{note}</span>}
      </div>
      {children}
    </div>
  );
}
