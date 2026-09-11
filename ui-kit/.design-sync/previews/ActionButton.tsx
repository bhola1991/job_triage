import { ActionButton } from 'job-triage-ui';

export function Go() {
  return <ActionButton tone="go" emphasis="fill">Apply</ActionButton>;
}

export function Due() {
  return <ActionButton tone="due" emphasis="fill">Write the chase</ActionButton>;
}

export function Awaiting() {
  return <ActionButton tone="awaiting" emphasis="outline">Chase on 09-18</ActionButton>;
}

export function Neutral() {
  return <ActionButton tone="neutral">Skip</ActionButton>;
}

export function Disabled() {
  return <ActionButton tone="go" emphasis="fill" disabled>Apply</ActionButton>;
}
