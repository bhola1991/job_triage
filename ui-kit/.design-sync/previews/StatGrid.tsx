import type { CSSProperties } from 'react';
import { StatGrid } from 'job-triage-ui';

const ground: CSSProperties = { background: 'var(--ink)', padding: 20 };

export function Default() {
  return (
    <div data-palette="v2" style={ground}>
      <StatGrid
        items={[
          { label: 'Rank', value: 65, tone: 'go' },
          { label: 'Fit', value: 70 },
          { label: 'Reach', value: 61 },
          { label: 'Window', value: '24d', tone: 'closing', caption: 'apply today or drop it' },
        ]}
      />
    </div>
  );
}
