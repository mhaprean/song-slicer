import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Keyboard, X } from 'lucide-react';

interface ShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

interface Group {
  title: string;
  items: { keys: string[]; desc: string }[];
}

const GROUPS: Group[] = [
  {
    title: 'Playback',
    items: [
      { keys: ['Space'], desc: 'Play / pause' },
      { keys: ['L'], desc: 'Loop selection on / off' },
      { keys: ['1'], desc: 'Switch to A/B slot A' },
      { keys: ['2'], desc: 'Switch to A/B slot B' },
    ],
  },
  {
    title: 'Loop editing',
    items: [
      { keys: ['['], desc: 'Set loop start at playhead' },
      { keys: [']'], desc: 'Set loop end at playhead' },
      { keys: ['←', '→'], desc: 'Move playhead by 10 ms' },
      { keys: ['Shift', '←', '→'], desc: 'Extend loop edges outward' },
      { keys: ['Alt', '←', '→'], desc: 'Shrink loop edges inward' },
      { keys: ['M'], desc: 'Add selection to the list' },
    ],
  },
  {
    title: 'View',
    items: [
      { keys: ['Scroll'], desc: 'Zoom at cursor' },
      { keys: ['Shift', 'Scroll'], desc: 'Pan horizontally' },
      { keys: ['F'], desc: 'Fit waveform to screen' },
      { keys: ['G'], desc: 'Toggle beat grid' },
      { keys: ['Dbl-click'], desc: 'Fit zoom (or reset loop when already fitted)' },
      { keys: ['+ / −'], desc: 'Zoom in / out (toolbar buttons)' },
    ],
  },
  {
    title: 'History & help',
    items: [
      { keys: ['Ctrl', 'Z'], desc: 'Undo loop change' },
      { keys: ['Ctrl', 'Shift', 'Z'], desc: 'Redo loop change' },
      { keys: ['?'], desc: 'This shortcuts dialog' },
      { keys: ['Esc'], desc: 'Close dialog' },
    ],
  },
];

export default function ShortcutsModal({ open, onClose }: ShortcutsModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      restoreRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="panel max-h-[85vh] w-full max-w-lg overflow-y-auto p-5"
      >
        <div className="mb-4 flex items-center gap-3">
          <Keyboard size={18} className="text-indigo-300" aria-hidden />
          <h2 id="shortcuts-title" className="text-base font-bold">
            Keyboard shortcuts
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="icon-btn ml-auto"
            aria-label="Close shortcuts dialog"
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        <div className="space-y-5">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="eyebrow mb-2">{group.title}</h3>
              <dl>
                {group.items.map((item) => (
                  <div
                    key={item.desc}
                    className="flex items-center justify-between gap-4 border-b border-white/5 py-1.5 last:border-0"
                  >
                    <dd className="order-1 text-xs text-slate-400">{item.desc}</dd>
                    <dt className="order-2 flex shrink-0 items-center gap-1">
                      {item.keys.map((k, i) => (
                        <span key={k}>
                          {i > 0 && <span className="mx-0.5 text-[10px] text-slate-600">+</span>}
                          <kbd className="kbd">{k}</kbd>
                        </span>
                      ))}
                    </dt>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <p className="mt-5 rounded-xl border border-white/8 bg-black/20 px-3 py-2.5 text-[11px] leading-relaxed text-slate-500">
          Focus a loop handle on the waveform and use <kbd className="kbd">←</kbd>/
          <kbd className="kbd">→</kbd> to nudge that edge (hold <kbd className="kbd">Shift</kbd> for
          100&nbsp;ms steps). Numeric fields also accept arrow keys.
        </p>
      </div>
    </div>,
    document.body
  );
}
