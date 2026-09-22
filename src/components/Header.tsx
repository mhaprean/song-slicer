import { Keyboard, Music } from 'lucide-react';

interface HeaderProps {
  onShortcuts: () => void;
}

/** App chrome: brand + shortcut help. The file card (step 01) sits below it. */
export default function Header({ onShortcuts }: HeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#05070f]/85 backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-[1440px] items-center gap-3 px-3 sm:px-6">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-400 shadow-lg shadow-indigo-500/25"
          aria-hidden
        >
          <Music size={18} className="text-white" />
        </div>
        <div className="min-w-0 leading-tight">
          <h1 className="text-[15px] font-bold tracking-wide text-white">Audio Cutter</h1>
          <p className="hidden text-[11px] text-slate-500 sm:block">
            Slice loops &amp; export WAV/MP3 — right in your browser
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onShortcuts}
            className="btn icon-btn-bordered !gap-1.5"
            title="Keyboard shortcuts (?)"
            aria-label="Show keyboard shortcuts"
          >
            <Keyboard size={15} aria-hidden />
            <span className="hidden text-xs sm:inline">Shortcuts</span>
          </button>
        </div>
      </div>
    </header>
  );
}
