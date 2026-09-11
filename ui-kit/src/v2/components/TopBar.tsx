import type { ReactNode } from 'react';

export interface TopBarProps {
  title: string;
  subtitle?: string;
  /** Status count badges, e.g. <StatusPill tone="due">1 overdue</StatusPill>. */
  badges?: ReactNode;
  /** Initials shown in the avatar circle. */
  avatarInitials?: string;
}

/** The app header: title, subtitle, status badges, avatar. */
export function TopBar({ title, subtitle, badges, avatarInitials }: TopBarProps) {
  return (
    <div data-palette="v2" className="topbar2">
      <span className="title">{title}</span>
      {subtitle && <span className="sub">{subtitle}</span>}
      <div className="spacer" />
      {badges}
      {avatarInitials && <div className="avatar">{avatarInitials}</div>}
    </div>
  );
}
