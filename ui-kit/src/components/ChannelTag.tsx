import type { ReactNode } from 'react';

export interface ChannelTagProps {
  tone: 'posted' | 'cold';
  children: ReactNode;
}

/** Filled pill naming where a job came from — posted role or a cold approach. */
export function ChannelTag({ tone, children }: ChannelTagProps) {
  return <span className={`chn ${tone}`}>{children}</span>;
}
