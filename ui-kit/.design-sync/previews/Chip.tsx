import { Chip } from 'job-triage-ui';

export function Default() {
  return <Chip>ycombinator.com</Chip>;
}

export function Good() {
  return <Chip tone="good">ran multi-state field ops</Chip>;
}

export function Bad() {
  return <Chip tone="bad">no formal CS degree</Chip>;
}
