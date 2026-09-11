import type { ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 'primary' is the single filled action per context; 'secondary' is the default. */
  variant?: 'primary' | 'secondary';
  size?: 'default' | 'sm';
}

/** The one primary action per context, plus secondary and small variants. */
export function Button({ variant = 'secondary', size = 'default', className = '', ...rest }: ButtonProps) {
  const cls = [variant === 'primary' ? 'btn-go' : '', size === 'sm' ? 'btn-sm' : '', className]
    .filter(Boolean)
    .join(' ');
  return <button className={cls} {...rest} />;
}
