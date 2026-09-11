import type { CSSProperties } from 'react';
import { StageTag } from 'job-triage-ui';

// StageTag has no background of its own — like the real app, it only ever
// sits on the dark page ground. Composing on that ground here is the only
// render that's true.
const ground: CSSProperties = { background: 'var(--ink)', padding: 16, borderRadius: 4 };

export function New() {
  return <div style={ground}><StageTag tone="new">New</StageTag></div>;
}

export function Sent() {
  return <div style={ground}><StageTag tone="sent">Sent</StageTag></div>;
}

export function Due() {
  return <div style={ground}><StageTag tone="due">Due</StageTag></div>;
}

export function Live() {
  return <div style={ground}><StageTag tone="live">Live</StageTag></div>;
}

export function Closed() {
  return <div style={ground}><StageTag tone="closed">Closed</StageTag></div>;
}

export function AgeHot() {
  return <div style={ground}><StageTag tone="age" ageModifier="hot">4d ago</StageTag></div>;
}

export function AgeStale() {
  return <div style={ground}><StageTag tone="age" ageModifier="stale">4mo ago</StageTag></div>;
}

export function AgeGuess() {
  return <div style={ground}><StageTag tone="age" ageModifier="guess">~2–6w ago</StageTag></div>;
}
