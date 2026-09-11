import type { CSSProperties } from 'react';
import { Callout } from 'job-triage-ui';

// Callout's own background is a translucent tint (rgba over the ground), so
// it still needs the real dark ground behind it to read as designed.
const ground: CSSProperties = { background: 'var(--ink)', padding: 16 };

export function Closing() {
  return (
    <div data-palette="v2" style={ground}>
      <Callout tone="closing">
        Postings this old are usually filled within the fortnight. Send it today or skip it honestly.
      </Callout>
    </div>
  );
}

export function Due() {
  return (
    <div data-palette="v2" style={ground}>
      <Callout tone="due">
        Nudge it today — eleven days silent is long enough to lose the thread.
      </Callout>
    </div>
  );
}
