import type { ReactNode } from 'react';

export interface FlagProps {
  tone?: 'neutral' | 'good' | 'bad';
  children: ReactNode;
}

/** A scorer's verdict — only flags get green or red, chips never do. */
export function Flag({ tone = 'neutral', children }: FlagProps) {
  const cls = ['flag', tone === 'good' ? 'g' : tone === 'bad' ? 'r' : ''].filter(Boolean).join(' ');
  return <span className={cls}>{children}</span>;
}
