import type { CSSProperties } from 'react';
import { Timeline } from 'job-triage-ui';

const ground: CSSProperties = { background: 'var(--ink)', padding: 16 };

export function JobHistory() {
  return (
    <div data-palette="v2" style={ground}>
      <Timeline
        entries={[
          { date: '2026-08-18', text: 'Found on the Ashby feed, full description read.' },
          { date: '2026-08-19', text: 'Scored 70 / 61 — high confidence.', tone: 'go' },
          { date: '2026-08-29', text: 'Snoozed for a week.' },
          {
            date: '2026-09-11',
            text: 'Twenty-four days old — moved to closing.',
            tone: 'closing',
            highlight: true,
          },
        ]}
      />
    </div>
  );
}
