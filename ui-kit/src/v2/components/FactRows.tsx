import type { ReactNode } from 'react';

export interface FactRow {
  label: string;
  value: ReactNode;
  tone?: 'go' | 'due' | 'closing' | 'awaiting';
}

export interface FactRowsProps {
  items: FactRow[];
}

/** A ruled label→value list — the sidebar's daily stats, or the detail rail's record panel. */
export function FactRows({ items }: FactRowsProps) {
  return (
    <div data-palette="v2" className="factrows">
      {items.map((it, i) => (
        <div className="r" key={i}>
          <span className="k">{it.label}</span>
          <span className={`v ${it.tone ?? ''}`}>{it.value}</span>
        </div>
      ))}
    </div>
  );
}
