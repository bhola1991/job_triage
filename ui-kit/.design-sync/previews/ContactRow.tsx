import type { CSSProperties } from 'react';
import { ContactRow, StatusPill } from 'job-triage-ui';

const ground: CSSProperties = { background: 'var(--ink)', padding: 16 };

export function HiringManager() {
  return (
    <div data-palette="v2" style={ground}>
      <ContactRow
        name="Rohit K."
        role="Head of solutions · likely hiring manager"
        status={<StatusPill tone="awaiting">DM open</StatusPill>}
      />
    </div>
  );
}

export function PublicProfile() {
  return (
    <div data-palette="v2" style={ground}>
      <ContactRow
        name="Meera T."
        role="Solutions engineer · public profile"
        status={<StatusPill tone="neutral">no channel</StatusPill>}
      />
    </div>
  );
}
