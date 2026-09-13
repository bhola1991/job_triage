// One runnable check: render every exported component once and assert it
// produced non-empty, expected-looking markup. No test framework needed.
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';
import * as UI from '../dist/index.js';

const cases = [
  [UI.StatusPill, { tone: 'due', children: '1 overdue' }, 'pill2 due'],
  [UI.ActionButton, { tone: 'go', emphasis: 'fill', children: 'Apply' }, 'Apply'],
  [
    UI.QueueSection,
    { title: 'Overdue', count: 1, tone: 'due', note: 'a nudge beats starting somewhere new', children: h('div', null, 'row') },
    'Overdue',
  ],
  [
    UI.QueueRow,
    {
      accentTone: 'go', rank: 72, rankTone: 'go',
      title: 'Forward Deployed Engineer', subtitle: 'Sarvam AI · Bangalore · posted role',
      facts: [{ label: 'fit / reach', value: '82 · 54' }, { label: 'posted', value: '4d ago' }],
      actions: h(UI.ActionButton, { tone: 'go', emphasis: 'fill' }, 'Apply'),
    },
    'Forward Deployed Engineer',
  ],
  [UI.DetailHeader, { tone: 'closing', eyebrow: 'closing — posted 24 days ago', title: 'Staff Solutions Engineer', subtitle: 'Portkey · Remote, India' }, 'Staff Solutions Engineer'],
  [
    UI.StatGrid,
    { items: [{ label: 'Rank', value: 65, tone: 'go' }, { label: 'Window', value: '24d', tone: 'closing', caption: 'apply today or drop it' }] },
    'Rank',
  ],
  [
    UI.ReasonPanel,
    { heading: 'Why it fits', children: 'Your four enterprise rollouts are the whole argument.', pills: [{ label: 'direct experience', tone: 'go' }] },
    'Why it fits',
  ],
  [UI.FactRows, { items: [{ label: 'channel', value: 'posted role' }, { label: 'posted window', value: '08-18 exact', tone: 'closing' }] }, 'channel'],
  [UI.ContactRow, { name: 'Rohit K.', role: 'Head of solutions', status: h(UI.StatusPill, { tone: 'awaiting' }, 'DM open') }, 'Rohit K.'],
  [UI.Timeline, { entries: [{ date: '2026-09-11', text: 'Twenty-four days old — moved to closing.', tone: 'closing', highlight: true }] }, 'moved to closing'],
  [UI.Callout, { tone: 'closing', children: 'Send it today or skip it honestly.' }, 'skip it honestly'],
  [
    UI.TopBar,
    { title: 'Job Triage', subtitle: 'AI Operations · Bangalore + remote', badges: h(UI.StatusPill, { tone: 'due' }, '1 overdue'), avatarInitials: 'SB' },
    'Job Triage',
  ],
  [UI.PostingLink, { url: 'https://example.com/job', title: 'Forward Deployed Engineer' }, 'open the original posting'],
  [UI.PostingLink, { url: 'nan', title: 'Solutions Engineer', company: 'Hasura', location: 'Remote' }, 'google.com/search?q=Solutions%20Engineer%20Hasura%20Remote%20job'],
  [UI.ColorKey, { counts: { go: 3, due: 1 } }, 'Do this now'],
  [UI.QueueRow, { accentTone: 'go', rank: 72, title: 'Clickable row', subtitle: 'Sarvam AI', onOpen: () => {} }, 'qrow clickable'],
];

let failures = 0;
for (const [Component, props, expect] of cases) {
  const name = Component.name ?? Component.displayName ?? '(anonymous)';
  let html;
  try {
    html = renderToStaticMarkup(h(Component, props));
  } catch (err) {
    console.error(`FAIL ${name}: threw`, err);
    failures++;
    continue;
  }
  if (!html || !html.includes(expect)) {
    console.error(`FAIL ${name}: expected output to include ${JSON.stringify(expect)}, got: ${html}`);
    failures++;
    continue;
  }
  console.log(`ok   ${name}`);
}

console.log(`\n${cases.length - failures}/${cases.length} components rendered as expected.`);
if (failures > 0) process.exit(1);
