import { StatusPill } from 'job-triage-ui';

export function Due() {
  return <StatusPill tone="due">1 overdue</StatusPill>;
}

export function Closing() {
  return <StatusPill tone="closing">2 closing</StatusPill>;
}

export function Awaiting() {
  return <StatusPill tone="awaiting">14 awaiting</StatusPill>;
}

export function Go() {
  return <StatusPill tone="go">direct experience</StatusPill>;
}

export function Neutral() {
  return <StatusPill tone="neutral">no visa question</StatusPill>;
}
