import type { InputHTMLAttributes } from 'react';

export interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

/** A labelled text input with an optional hint underneath. Inputs are mono — most of what's typed here is machine-ish. */
export function FormField({ label, hint, id, ...rest }: FormFieldProps) {
  const inputId = id ?? `field-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div>
      <label className="lab" htmlFor={inputId}>{label}</label>
      <input id={inputId} type="text" {...rest} />
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}
