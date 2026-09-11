import { SegmentedControl } from 'job-triage-ui';

export function StatusFilter() {
  return (
    <SegmentedControl
      options={[
        { label: 'All', value: 'all', count: 214 },
        { label: 'Posted', value: 'posted', count: 176 },
        { label: 'Cold', value: 'cold', count: 38 },
      ]}
      value="posted"
      onChange={() => {}}
    />
  );
}

export function SortOrder() {
  return (
    <SegmentedControl
      options={[
        { label: 'Best', value: 'best' },
        { label: 'Recently posted', value: 'recent' },
        { label: 'Recently added', value: 'added' },
      ]}
      value="best"
      onChange={() => {}}
    />
  );
}

export function FirstOptionSelected() {
  return (
    <SegmentedControl
      options={[
        { label: 'All', value: 'all', count: 214 },
        { label: 'Posted', value: 'posted', count: 176 },
        { label: 'Cold', value: 'cold', count: 38 },
      ]}
      value="all"
      onChange={() => {}}
    />
  );
}
