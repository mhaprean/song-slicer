import { useId } from 'react';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  title?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Accessible toggle: real checkbox (keyboard + screen reader) with a styled
 * track/knob. State is conveyed by knob position — never color alone.
 */
export default function Switch({
  checked,
  onChange,
  label,
  title,
  disabled = false,
  className = '',
}: SwitchProps) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      title={title}
      className={`flex items-center gap-2 text-xs text-slate-300 select-none ${
        disabled ? 'opacity-50' : 'cursor-pointer'
      } ${className}`}
    >
      <input
        id={id}
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden
        className="relative w-8 h-[18px] shrink-0 rounded-full border border-white/15 bg-white/10 transition-colors peer-checked:border-indigo-400 peer-checked:bg-indigo-500 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-400/70 after:absolute after:left-[2px] after:top-[2px] after:h-3 after:w-3 after:rounded-full after:bg-slate-300 after:transition-transform after:content-[''] peer-checked:after:translate-x-[14px] peer-checked:after:bg-white"
      />
      <span className="whitespace-nowrap">{label}</span>
    </label>
  );
}
