// One runnable check: render every exported component once and assert it
// produced non-empty, expected-looking markup. No test framework needed.
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';
import * as UI from '../dist/index.js';

const cases = [
  [UI.Button, { variant: 'primary', children: 'Draft outreach' }, 'Draft outreach'],
  [UI.SegmentedControl, { options: [{ label: 'All', value: 'all', count: 214 }], value: 'all', onChange: () => {} }, 'All'],
  [UI.ChannelTag, { tone: 'posted', children: 'posted role' }, 'chn posted'],
  [UI.StageTag, { tone: 'due', children: 'due' }, 's-due'],
  [UI.Chip, { tone: 'good', children: 'ran multi-state field ops' }, 'chip g'],
  [UI.Flag, { tone: 'bad', children: 'credential gated' }, 'flag r'],
  [UI.FormField, { label: 'Location', defaultValue: 'Bangalore' }, 'Location'],
  [UI.Disclosure, { summary: 'Data & keys', children: h('div', null, 'x') }, 'Data &amp; keys'],
  [UI.FitReachMeter, { score: 72, fit: 82, reach: 54 }, '72'],
  [UI.EmptyState, { title: 'Nothing clears the bar', children: 'Pull in more roles.' }, 'Nothing clears the bar'],
  [UI.Banner, { title: '3 follow-ups overdue', tone: 'urgent', children: 'A short nudge beats starting somewhere new.' }, '3 follow-ups overdue'],
  [
    UI.JobCard,
    {
      title: 'Forward Deployed Engineer', company: 'Sarvam AI', location: 'Bangalore, India',
      channel: 'posted', stage: 'new', metaLabel: '4d ago', metaAgeModifier: 'hot',
      score: 72, fit: 82, reach: 54, note: 'Ops-heavy deployment role.',
      flags: [{ label: 'strong fit', tone: 'good' }],
      primaryAction: { label: 'Draft outreach' },
    },
    'Forward Deployed Engineer',
  ],
  [
    UI.JobCard,
    {
      title: 'Cold approach', company: 'Cropin', location: 'Bangalore, India',
      channel: 'cold', stage: 'new', metaLabel: '2 contacts',
      score: 68, fit: 71, reach: 63,
    },
    'Cropin',
  ],

  // v2 — go/due/closing/awaiting
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
