import type { ReactNode } from 'react';

export interface ContactRowProps {
  name: string;
  role: string;
  /** Trailing status, e.g. a <StatusPill tone="awaiting">DM open</StatusPill>. */
  status?: ReactNode;
}

/** A found contact — name, role, and a trailing status pill. */
export function ContactRow({ name, role, status }: ContactRowProps) {
  return (
    <div data-palette="v2" className="contact-row">
      <div>
        <div className="nm">{name}</div>
        <div className="role">{role}</div>
      </div>
      {status}
    </div>
  );
}
