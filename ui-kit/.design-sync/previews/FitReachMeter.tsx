import { FitReachMeter } from 'job-triage-ui';

export function PostedRole() {
  return <FitReachMeter score={72} fit={82} reach={54} />;
}

export function ColdApproach() {
  return <FitReachMeter score={68} fit={71} reach={63} accentColor="var(--cold)" />;
}
