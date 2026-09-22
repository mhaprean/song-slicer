import { useEffect, useState } from 'react';

interface TimeFieldProps {
  value: number;
  onCommit: (v: number) => void;
  ariaLabel: string;
  className?: string;
}

/**
 * Numeric seconds field (mm:ss.mmm style input as plain seconds with 3 decimals).
 * Commits valid values live, reverts on blur, nudges with arrow keys
 * (1 ms steps, 100 ms with Shift).
 */
export default function TimeField({ value, onCommit, ariaLabel, className = '' }: TimeFieldProps) {
  const [draft, setDraft] = useState(value.toFixed(3));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(value.toFixed(3));
  }, [value, focused]);

  const commitRaw = (raw: string) => {
    setDraft(raw);
    const v = parseFloat(raw);
    if (!isNaN(v) && isFinite(v) && v >= 0) onCommit(v);
  };

  const nudge = (dir: 1 | -1, shift: boolean) => {
    const step = shift ? 0.1 : 0.001;
    const next = Math.max(0, Math.round((value + dir * step) * 1000) / 1000);
    setDraft(next.toFixed(3));
    onCommit(next);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={focused ? draft : value.toFixed(3)}
      onFocus={(e) => {
        setFocused(true);
        setDraft(value.toFixed(3));
        e.target.select();
      }}
      onChange={(e) => commitRaw(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          nudge(1, e.shiftKey);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          nudge(-1, e.shiftKey);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
      onBlur={() => {
        setFocused(false);
        setDraft(value.toFixed(3));
      }}
      className={`field field-mono w-24 text-right ${className}`}
      title={`${ariaLabel}: seconds with millisecond precision (↑/↓ to nudge)`}
    />
  );
}
