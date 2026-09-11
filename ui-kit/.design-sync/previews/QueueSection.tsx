import type { CSSProperties } from 'react';
import { QueueSection, QueueRow, ActionButton } from 'job-triage-ui';

const ground: CSSProperties = { background: 'var(--ink)', padding: 16 };

export function Overdue() {
  return (
    <div data-palette="v2" style={ground}>
      <QueueSection title="Overdue" count={1} tone="due" note="a nudge beats starting somewhere new">
        <QueueRow
          accentTone="due"
          rank={70}
          rankTone="neutral"
          title="AI Operations Lead"
          subtitle="Observe.AI · Bangalore"
          facts={[{ label: 'silent for', value: '11 days', tone: 'due' }, { label: 'sent', value: '08-31' }]}
          actions={
            <>
              <ActionButton tone="neutral">They replied</ActionButton>
              <ActionButton tone="due" emphasis="fill">Write the chase</ActionButton>
            </>
          }
        />
      </QueueSection>
    </div>
  );
}

export function DoTheseFirst() {
  return (
    <div data-palette="v2" style={ground}>
      <QueueSection title="Do these first" count={9} tone="go" note="sorted by rank">
        <QueueRow
          accentTone="go"
          rank={72}
          rankTone="go"
          title="Forward Deployed Engineer"
          subtitle="Sarvam AI · Bangalore · posted role"
          facts={[{ label: 'fit / reach', value: '82 · 54' }, { label: 'posted', value: '4d ago' }]}
          actions={
            <>
              <ActionButton tone="neutral">Skip</ActionButton>
              <ActionButton tone="neutral">Details</ActionButton>
              <ActionButton tone="go" emphasis="fill">Apply</ActionButton>
            </>
          }
        />
        <QueueRow
          accentTone="awaiting"
          rank={63}
          rankTone="neutral"
          title="Platform Ops Manager"
          subtitle="Zeta · Bangalore · applied"
          facts={[{ label: 'state', value: 'in review', tone: 'awaiting' }, { label: 'sent', value: '4d ago' }]}
          actions={
            <>
              <ActionButton tone="neutral">They replied</ActionButton>
              <ActionButton tone="awaiting" emphasis="outline">Chase on 09-18</ActionButton>
            </>
          }
        />
      </QueueSection>
    </div>
  );
}

export function ClosingSoon() {
  return (
    <div data-palette="v2" style={ground}>
      <QueueSection title="Closing soon" count={2} tone="closing" note="old postings get filled, not withdrawn">
        <QueueRow
          accentTone="closing"
          rank={65}
          rankTone="go"
          title="Staff Solutions Engineer"
          subtitle="Portkey · Remote · posted role"
          facts={[{ label: 'fit / reach', value: '70 · 61' }, { label: 'posted', value: '24d ago', tone: 'closing' }]}
          actions={
            <>
              <ActionButton tone="neutral">Skip</ActionButton>
              <ActionButton tone="go" emphasis="fill">Apply today</ActionButton>
            </>
          }
        />
      </QueueSection>
    </div>
  );
}
