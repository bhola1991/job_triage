import type { CSSProperties } from 'react';
import { ColorKey } from 'job-triage-ui';

// Transparent by design: in the app it sits in the dark sidebar.
const ground: CSSProperties = { background: 'var(--panel)', padding: 16, maxWidth: 280 };

export function Sidebar() {
  return (
    <div data-palette="v2" style={ground}>
      <ColorKey counts={{ go: 9, due: 1, closing: 2, awaiting: 14, closed: 62 }} />
    </div>
  );
}

export function EmptyTracker() {
  return (
    <div data-palette="v2" style={ground}>
      <ColorKey />
    </div>
  );
}
