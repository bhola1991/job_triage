import { ReasonPanel } from 'job-triage-ui';

export function WhyItFits() {
  return (
    <ReasonPanel
      heading="Why it fits"
      pills={[{ label: 'direct experience', tone: 'go' }, { label: 'rare combination', tone: 'go' }]}
    >
      A deployment role at an infrastructure company selling to engineering teams. Your four enterprise
      rollouts are the whole argument, and the posting asks for exactly the customer-facing half of that work.
    </ReasonPanel>
  );
}

export function WhyReachable() {
  return (
    <ReasonPanel
      heading="Why it is reachable"
      pills={[{ label: 'no visa question', tone: 'neutral' }, { label: 'shortlist likely', tone: 'closing' }]}
    >
      Remote-first and hiring in India, so no visa question. Against it: twenty-four days open means a
      shortlist already exists, and nobody here has answered a cold message from you before.
    </ReasonPanel>
  );
}
