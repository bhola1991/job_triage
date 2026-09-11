import type { ReactNode } from 'react';

export interface StageTagProps {
  tone: 'new' | 'sent' | 'due' | 'live' | 'closed' | 'age';
  /** Only meaningful when tone="age": recent postings run hot, old ones stale, unstated dates are a guess. */
  ageModifier?: 'hot' | 'stale' | 'guess';
  children: ReactNode;
}

/** Outlined pill for pipeline stage or posting age. */
export function StageTag({ tone, ageModifier, children }: StageTagProps) {
  const cls = ['stage', `s-${tone}`, tone === 'age' ? ageModifier : undefined].filter(Boolean).join(' ');
  return <span className={cls}>{children}</span>;
}
