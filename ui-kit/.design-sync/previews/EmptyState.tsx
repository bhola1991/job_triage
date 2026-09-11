import type { CSSProperties } from 'react';
import { EmptyState } from 'job-triage-ui';

// EmptyState's title uses var(--text) with no background of its own — like
// the real app, it only ever sits on the dark page ground.
const ground: CSSProperties = { background: 'var(--ink)', padding: 16, borderRadius: 4 };

export function NothingClearsTheBar() {
  return (
    <div style={ground}>
      <EmptyState title="Nothing clears the bar">
        Either this batch was weak or you have worked through it — pull in more roles.
      </EmptyState>
    </div>
  );
}

export function NoColdApproachesYet() {
  return (
    <div style={ground}>
      <EmptyState title="No cold approaches yet">
        Add a company and a contact to start one — it doesn't need a posted role.
      </EmptyState>
    </div>
  );
}
