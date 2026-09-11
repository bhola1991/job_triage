import { JobCard } from 'job-triage-ui';

export function PostedRole() {
  return (
    <JobCard
      title="Forward Deployed Engineer"
      company="Sarvam AI"
      location="Bangalore, India"
      channel="posted"
      stage="new"
      metaLabel="4d ago"
      metaAgeModifier="hot"
      score={72}
      fit={82}
      reach={54}
      note="Ops-heavy deployment role at a lab small enough to read the application."
      flags={[{ label: 'strong fit', tone: 'good' }, { label: 'rare combination fit', tone: 'good' }]}
      primaryAction={{ label: 'Draft outreach' }}
      secondaryActions={[{ label: 'Mark applied' }, { label: 'Details' }]}
      openHref="#"
    />
  );
}

export function ColdApproach() {
  return (
    <JobCard
      title="Cold approach"
      company="Cropin"
      location="Bangalore, India"
      channel="cold"
      channelLabel="cold approach"
      stage="new"
      metaLabel="2 contacts"
      score={68}
      fit={71}
      reach={63}
      note="Agritech ops is the exact overlap; small enough that a direct message lands."
      primaryAction={{ label: 'Write the DM' }}
      secondaryActions={[{ label: 'Mark contacted' }, { label: 'Details' }]}
    />
  );
}

export function SentWaiting() {
  return (
    <JobCard
      title="Solutions Engineer, India"
      company="Hasura"
      location="Remote"
      channel="posted"
      stage="sent"
      metaLabel="3d silent"
      score={66}
      fit={74}
      reach={52}
      secondaryActions={[{ label: 'Details' }]}
    />
  );
}
