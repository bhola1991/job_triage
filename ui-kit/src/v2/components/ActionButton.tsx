import type { ButtonHTMLAttributes } from 'react';

export interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: 'go' | 'due' | 'awaiting' | 'neutral';
  emphasis?: 'fill' | 'outline';
  size?: 'default' | 'sm';
}

/** A row or rail action, filled buttons are always the ink accent (tone shows in the outline), outline buttons carry the tone's wash. */
export function ActionButton({ tone = 'neutral', emphasis = 'outline', size = 'default', className = '', ...rest }: ActionButtonProps) {
  const cls = ['btn2', emphasis, tone, size === 'sm' ? 'sm' : '', className].filter(Boolean).join(' ');
  return <button data-palette="v2" className={cls} {...rest} />;
}
