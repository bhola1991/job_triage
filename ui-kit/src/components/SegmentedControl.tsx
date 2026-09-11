export interface SegmentedControlOption {
  label: string;
  value: string;
  /** Optional trailing count, e.g. "214". */
  count?: number | string;
}

export interface SegmentedControlProps {
  options: SegmentedControlOption[];
  value: string;
  onChange: (value: string) => void;
}

/** A filter toggle group (changes what a view shows), not navigation. */
export function SegmentedControl({ options, value, onChange }: SegmentedControlProps) {
  return (
    <div className="segs">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`seg${opt.value === value ? ' on' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
          {opt.count !== undefined && (
            <span className="mono" style={{ fontSize: 11, color: 'var(--dim)', marginLeft: 6 }}>
              {opt.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
