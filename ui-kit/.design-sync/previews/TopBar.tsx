import { TopBar, StatusPill } from 'job-triage-ui';

export function Default() {
  return (
    <TopBar
      title="Job Triage"
      subtitle="AI Operations · Bangalore + remote"
      badges={
        <>
          <StatusPill tone="due">1 overdue</StatusPill>
          <StatusPill tone="closing">2 closing</StatusPill>
          <StatusPill tone="awaiting">14 awaiting</StatusPill>
        </>
      }
      avatarInitials="SB"
    />
  );
}
