export interface StatGridItem {
  label: string;
  value: number | string;
  tone?: 'go' | 'due' | 'closing' | 'awaiting';
  caption?: string;
}

export interface StatGridProps {
  /** Typically 4: Rank, Fit, Reach, Window. */
  items: StatGridItem[];
}

/** The detail view's stat row — a big mono figure per stat, ruled top and bottom. */
export function StatGrid({ items }: StatGridProps) {
  return (
    <div data-palette="v2" className="stat4">
      {items.map((it) => (
        <div className="cell" key={it.label}>
          <div className="eb">{it.label}</div>
          <div className={`val ${it.tone ?? ''}`}>{it.value}</div>
          {it.caption && <div className={`cap ${it.tone ?? ''}`}>{it.caption}</div>}
        </div>
      ))}
    </div>
  );
}
