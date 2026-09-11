import type { ReactNode } from 'react';
import { StatusPill, type StatusPillProps } from './StatusPill.js';

export interface ReasonPanelPill {
  label: string;
  tone?: StatusPillProps['tone'];
}

export interface ReasonPanelProps {
  heading: string;
  children: ReactNode;
  pills?: ReasonPanelPill[];
}

/** "Why it fits" / "why it's reachable" — a heading, body copy, and supporting pills. Compose two side by side for the detail view's two-column layout. */
export function ReasonPanel({ heading, children, pills }: ReasonPanelProps) {
  return (
    <div data-palette="v2">
      <div className="reason-h">{heading}</div>
      <div className="reason-body">{children}</div>
      {pills && pills.length > 0 && (
        <div className="reason-pills">
          {pills.map((p) => <StatusPill key={p.label} tone={p.tone}>{p.label}</StatusPill>)}
        </div>
      )}
    </div>
  );
}
