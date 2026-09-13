export interface ColorKeyProps {
  /** How many rows currently carry each instruction. Omitted counts show as 0. */
  counts?: { go?: number; due?: number; closing?: number; awaiting?: number; closed?: number };
}

const ROWS = [
  { tone: 'go', head: 'Do this now', sub: 'your move, nothing blocking' },
  { tone: 'due', head: 'Overdue', sub: 'past the follow-up date' },
  { tone: 'closing', head: 'Closing', sub: 'old posting, going off the board' },
  { tone: 'awaiting', head: 'Awaiting', sub: 'sent, and not your move yet' },
  { tone: 'closed', head: 'Closed', sub: 'answered no, or ran out' },
] as const;

/** The colour law as a legend: what each accent means, with how many rows it holds. */
export function ColorKey({ counts = {} }: ColorKeyProps) {
  return (
    <div data-palette="v2" className="colorkey">
      {ROWS.map((r) => (
        <div className={`lg ${r.tone}`} key={r.tone}>
          <i />
          <div>
            <div className="lg-h">{r.head}</div>
            <div className="lg-s">{r.sub}</div>
          </div>
          <span className="num">{counts[r.tone] ?? 0}</span>
        </div>
      ))}
    </div>
  );
}
