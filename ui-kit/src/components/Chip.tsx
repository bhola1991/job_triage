import type { ReactNode } from 'react';

export interface ChipProps {
  tone?: 'neutral' | 'good' | 'bad';
  children: ReactNode;
}

/** A profile fact or board name — a label, not a judgement. */
export function Chip({ tone = 'neutral', children }: ChipProps) {
  const cls = ['chip', tone === 'good' ? 'g' : tone === 'bad' ? 'r' : ''].filter(Boolean).join(' ');
  return <span className={cls}>{children}</span>;
}
