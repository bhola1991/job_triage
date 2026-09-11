import { Flag } from 'job-triage-ui';

export function Good() {
  return <Flag tone="good">strong fit</Flag>;
}

export function GoodRareCombination() {
  return <Flag tone="good">rare combination fit</Flag>;
}

export function Neutral() {
  return <Flag tone="neutral">thin data</Flag>;
}

export function Bad() {
  return <Flag tone="bad">credential gated</Flag>;
}
