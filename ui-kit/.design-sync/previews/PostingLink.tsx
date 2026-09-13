import type { CSSProperties } from 'react';
import { PostingLink } from 'job-triage-ui';

// Sits in the detail rail on the app's dark panel.
const ground: CSSProperties = { background: 'var(--panel)', padding: 16 };

export function WithLink() {
  return (
    <div data-palette="v2" style={ground}>
      <PostingLink url="https://jobs.ashbyhq.com/portkey/staff-solutions-engineer" title="Staff Solutions Engineer" company="Portkey" location="Remote" />
    </div>
  );
}

export function NoLinkSaved() {
  return (
    <div data-palette="v2" style={ground}>
      <PostingLink title="Solutions Engineer" company="Hasura" location="Remote" />
    </div>
  );
}

export function CsvNanLink() {
  return (
    <div data-palette="v2" style={ground}>
      <PostingLink url="nan" title="Automation Specialist" company="Upwork Client" location="Remote" />
    </div>
  );
}
