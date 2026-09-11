import { Button } from 'job-triage-ui';

export function Primary() {
  return <Button variant="primary">Mark applied</Button>;
}

export function Secondary() {
  return <Button>Details</Button>;
}

export function Small() {
  return <Button variant="primary" size="sm">Apply</Button>;
}

export function Disabled() {
  return <Button variant="primary" disabled>Draft outreach</Button>;
}

export function SkipSecondarySmall() {
  return <Button size="sm">Skip</Button>;
}
