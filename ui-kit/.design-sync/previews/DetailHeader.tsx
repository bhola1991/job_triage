import type { CSSProperties } from 'react';
import { DetailHeader } from 'job-triage-ui';

const ground: CSSProperties = { background: 'var(--ink)', padding: 20 };

export function Closing() {
  return (
    <div data-palette="v2" style={ground}>
      <DetailHeader
        tone="closing"
        eyebrow="closing — posted 24 days ago"
        title="Staff Solutions Engineer"
        subtitle="Portkey · Remote, India · posted role · ashby feed"
      />
    </div>
  );
}

export function Due() {
  return (
    <div data-palette="v2" style={ground}>
      <DetailHeader
        tone="due"
        eyebrow="overdue — 11 days silent"
        title="AI Operations Lead"
        subtitle="Observe.AI · Bangalore · posted role"
      />
    </div>
  );
}
