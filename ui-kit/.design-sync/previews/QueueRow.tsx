import type { CSSProperties } from 'react';
import { QueueRow, ActionButton } from 'job-triage-ui';

// QueueRow's title/fact text has no background of its own — like the real
// queue screen, it only ever sits on the v2 dark page ground.
const ground: CSSProperties = { background: 'var(--ink)', padding: 16 };

export function Due() {
  return (
    <div data-palette="v2" style={ground}>
      <QueueRow
        accentTone="due"
        rank={70}
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
    </div>
  );
}

export function Go() {
  return (
    <div data-palette="v2" style={ground}>
      <QueueRow
        accentTone="go"
        rank={72}
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
    </div>
  );
}

export function Closing() {
  return (
    <div data-palette="v2" style={ground}>
      <QueueRow
        accentTone="closing"
        rank={65}
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
    </div>
  );
}

// With onOpen the whole row is clickable and lifts on hover; the hover itself
// can't be captured statically, so this cell shows the clickable layout.
export function Clickable() {
  return (
    <div data-palette="v2" style={ground}>
      <QueueRow
        accentTone="go"
        rank={75}
        title="Forward Deployed Engineer"
        subtitle="Sarvam AI · Bangalore · posted role"
        facts={[{ label: 'fit / reach', value: '82 · 64' }, { label: 'posted', value: '4d ago' }]}
        actions={
          <>
            <ActionButton tone="neutral" size="sm">Details</ActionButton>
            <ActionButton tone="go" emphasis="fill" size="sm">Draft outreach</ActionButton>
          </>
        }
        onOpen={() => {}}
      />
    </div>
  );
}

export function Awaiting() {
  return (
    <div data-palette="v2" style={ground}>
      <QueueRow
        accentTone="awaiting"
        rank={63}
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
    </div>
  );
}
