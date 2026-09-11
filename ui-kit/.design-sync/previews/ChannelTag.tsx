import { ChannelTag } from 'job-triage-ui';

export function Posted() {
  return <ChannelTag tone="posted">posted role</ChannelTag>;
}

export function Cold() {
  return <ChannelTag tone="cold">cold approach</ChannelTag>;
}
