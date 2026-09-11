import { Disclosure } from 'job-triage-ui';

export function OtherWaysToAdd() {
  return (
    <Disclosure summary="Other ways to add">
      <p>Paste a job URL directly, or forward the listing email to your triage inbox.</p>
      <p>Cold approaches can be added with just a company name and a contact.</p>
    </Disclosure>
  );
}

export function DataAndKeys() {
  return (
    <Disclosure summary="Data & keys" defaultOpen>
      <p>Portal API key: last synced 2h ago.</p>
      <p>Contact enrichment: 340 lookups left this month.</p>
    </Disclosure>
  );
}
