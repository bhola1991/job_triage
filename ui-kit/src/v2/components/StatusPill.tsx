import type { ReactNode } from 'react';

export interface StatusPillProps {
  tone?: 'go' | 'due' | 'closing' | 'awaiting' | 'neutral';
  children: ReactNode;
}

/** A tinted status pill — counts in the top bar, detail facts, contact states. One of the four accents, or neutral. */
export function StatusPill({ tone = 'neutral', children }: StatusPillProps) {
  return <span data-palette="v2" className={`pill2 ${tone}`}>{children}</span>;
}
