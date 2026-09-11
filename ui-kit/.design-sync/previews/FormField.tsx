import { FormField } from 'job-triage-ui';

export function WithHint() {
  return (
    <FormField
      label="Location"
      defaultValue="Bangalore"
      hint="Narrows the big portals to this place, and to anything remote. Blank searches worldwide."
    />
  );
}

export function NoHint() {
  return <FormField label="Company" defaultValue="Sarvam AI" />;
}
