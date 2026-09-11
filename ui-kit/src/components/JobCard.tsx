import type { ReactNode } from 'react';
import { Button } from './Button.js';
import { ChannelTag } from './ChannelTag.js';
import { StageTag, type StageTagProps } from './StageTag.js';
import { Flag } from './Flag.js';
import { FitReachMeter } from './FitReachMeter.js';

export interface JobCardFlag {
  label: string;
  tone?: 'neutral' | 'good' | 'bad';
}

export interface JobCardAction {
  label: string;
  onClick?: () => void;
}

export interface JobCardProps {
  title: string;
  company: string;
  location: string;
  channel: 'posted' | 'cold';
  channelLabel?: ReactNode;
  stage: StageTagProps['tone'];
  /** The second pill next to stage — an age ("4d ago") or a fact ("2 contacts", "3d silent"). */
  metaLabel: ReactNode;
  metaAgeModifier?: StageTagProps['ageModifier'];
  score: number;
  fit: number;
  reach: number;
  note?: string;
  flags?: JobCardFlag[];
  /** The one move that advances the pipeline. Omit when there's nothing to do (e.g. sent, waiting). */
  primaryAction?: JobCardAction;
  secondaryActions?: JobCardAction[];
  openHref?: string;
  /** Expands the card into its detail panel — bigger title, .jdet content below the actions. */
  open?: boolean;
  /** Content for the expanded .jdet panel (contacts, log, description). Only rendered when open. */
  detail?: ReactNode;
}

/** One primary action per card, then Details. The shipped list-row job card, every channel/stage combination. */
export function JobCard({
  title, company, location, channel, channelLabel, stage, metaLabel, metaAgeModifier,
  score, fit, reach, note, flags, primaryAction, secondaryActions, openHref, open, detail,
}: JobCardProps) {
  const accent = channel === 'cold' ? 'var(--cold)' : 'var(--signal)';
  const rowClass = ['job', `ch-${channel}`, stage === 'live' ? 'st-live' : '', stage === 'due' ? 'st-due' : '', open ? 'open' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rowClass}>
      <div className="jrow">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="jt">{title}</div>
          <div className="jc">{company} · {location}</div>
          <div className="chips" style={{ marginTop: 7 }}>
            <ChannelTag tone={channel}>{channelLabel ?? (channel === 'posted' ? 'posted role' : 'cold approach')}</ChannelTag>
            <StageTag tone={stage}>{stage}</StageTag>
            <StageTag tone="age" ageModifier={metaAgeModifier}>{metaLabel}</StageTag>
          </div>
        </div>
        <div className="jscore">
          <FitReachMeter score={score} fit={fit} reach={reach} accentColor={accent} />
        </div>
      </div>

      {note && <p className="jreason">{note}</p>}

      {flags && flags.length > 0 && (
        <div className="flags" style={{ marginTop: 8 }}>
          {flags.map((f) => <Flag key={f.label} tone={f.tone}>{f.label}</Flag>)}
        </div>
      )}

      <div className="jacts">
        {openHref && <a className="lnk" href={openHref} target="_blank" rel="noreferrer">open ↗</a>}
        <div style={{ flex: 1 }} />
        {primaryAction && (
          <Button variant="primary" onClick={primaryAction.onClick}>{primaryAction.label}</Button>
        )}
        {secondaryActions?.map((a) => (
          <Button key={a.label} onClick={a.onClick}>{a.label}</Button>
        ))}
      </div>

      {open && detail && <div className="jdet">{detail}</div>}
    </div>
  );
}
