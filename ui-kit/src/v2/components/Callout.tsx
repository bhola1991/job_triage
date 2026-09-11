import type { ReactNode } from 'react';

export interface CalloutProps {
  tone?: 'go' | 'due' | 'closing' | 'awaiting';
  children: ReactNode;
}

/** A tinted, left-accented instruction line — "apply today or skip it honestly". */
export function Callout({ tone = 'closing', children }: CalloutProps) {
  return (
    <div data-palette="v2" className={`callout ${tone}`}>
      <span className="msg">{children}</span>
    </div>
  );
}
