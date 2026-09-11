import type { CSSProperties } from 'react';
import { Banner } from 'job-triage-ui';

// Banner's title has no explicit colour of its own — like the real app, it
// only ever sits on the dark page ground.
const ground: CSSProperties = { background: 'var(--ink)', padding: 16, borderRadius: 4 };

export function Urgent() {
  return (
    <div style={ground}>
      <Banner title="3 follow-ups overdue" tone="urgent" action={{ label: 'Open follow-ups', onClick: () => {} }}>
        A short nudge beats starting somewhere new.
      </Banner>
    </div>
  );
}

export function Calm() {
  return (
    <div style={ground}>
      <Banner title="You're caught up" tone="calm">
        Nothing needs you right now.
      </Banner>
    </div>
  );
}
