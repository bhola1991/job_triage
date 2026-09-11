import type { ReactNode } from 'react';

export interface BannerProps {
  title: string;
  children: ReactNode;
  /** calm (green) when clear, urgent (red) when something is overdue. */
  tone?: 'calm' | 'urgent';
  action?: { label: string; onClick: () => void };
}

/** The single derived instruction shown above a tab: what to do, not what's missing. */
export function Banner({ title, children, tone = 'calm', action }: BannerProps) {
  return (
    <div className={`banner ${tone}`}>
      <div className="bt">
        <div className="bh">{title}</div>
        <div className="bs">{children}</div>
      </div>
      {action && (
        <button type="button" className="btn-go" onClick={action.onClick}>{action.label}</button>
      )}
    </div>
  );
}
