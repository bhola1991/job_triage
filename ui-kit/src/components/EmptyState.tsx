import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  children: ReactNode;
}

/** An empty state names the action that fills it, not just what's missing. */
export function EmptyState({ title, children }: EmptyStateProps) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children}
    </div>
  );
}
