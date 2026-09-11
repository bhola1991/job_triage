import type { ReactNode } from 'react';

export interface DisclosureProps {
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

/** Native <details> — for the rare half of a screen, one press away, with no script needed for open state. */
export function Disclosure({ summary, children, defaultOpen = false }: DisclosureProps) {
  return (
    <details className="fold" open={defaultOpen}>
      <summary>{summary}</summary>
      <div className="foldbody">{children}</div>
    </details>
  );
}
