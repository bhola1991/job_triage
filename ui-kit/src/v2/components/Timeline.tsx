export interface TimelineEntry {
  date: string;
  text: string;
  tone?: 'go' | 'due' | 'closing' | 'awaiting';
  /** Highlights the entry's text as the current-state one, not just a past event. */
  highlight?: boolean;
}

export interface TimelineProps {
  entries: TimelineEntry[];
}

/** A job's history — a dotted, dated log of what happened. */
export function Timeline({ entries }: TimelineProps) {
  return (
    <div data-palette="v2" className="timeline">
      {entries.map((e, i) => (
        <div className="entry" key={i}>
          <i className={`dot ${e.tone ?? ''}`} />
          <span className={`when ${e.tone ?? ''}`}>{e.date}</span>
          <span className={`what ${e.highlight ? 'hi' : ''}`}>{e.text}</span>
        </div>
      ))}
    </div>
  );
}
