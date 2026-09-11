import type { CSSProperties } from 'react';
import { FactRows } from 'job-triage-ui';

const ground: CSSProperties = { background: 'var(--ink)', padding: 16 };

export function TheRecord() {
  return (
    <div data-palette="v2" style={ground}>
      <FactRows
        items={[
          { label: 'channel', value: 'posted role' },
          { label: 'source', value: 'ashby feed' },
          { label: 'confidence', value: 'high — full text' },
          { label: 'posted window', value: '08-18 exact', tone: 'closing' },
          { label: 'state', value: 'not yet actioned', tone: 'go' },
        ]}
      />
    </div>
  );
}

export function TodayStats() {
  return (
    <div data-palette="v2" style={ground}>
      <FactRows
        items={[
          { label: 'triaged', value: '12 / 20' },
          { label: 'applied', value: 4, tone: 'go' },
          { label: 'chased', value: 2, tone: 'awaiting' },
          { label: 'skipped', value: 8 },
        ]}
      />
    </div>
  );
}
