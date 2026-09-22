import { Music, Upload, ArrowRight } from 'lucide-react';

interface FileDropZoneProps {
  dragging: boolean;
  onBrowse: () => void;
}

const STEPS = ['Load', 'Select', 'Preview', 'Save', 'Export'];

/**
 * Empty state (step 01): hero drop target that also teaches the whole
 * workflow at a glance. Drag events are handled once at the app root;
 * this component only reflects the `dragging` flag visually.
 */
export default function FileDropZone({ dragging, onBrowse }: FileDropZoneProps) {
  return (
    <div
      className={`panel w-full max-w-2xl px-6 py-12 text-center transition-all duration-200 sm:px-12 sm:py-16 ${
        dragging
          ? 'scale-[1.01] border-indigo-400/70 bg-indigo-500/10 shadow-2xl shadow-indigo-500/20'
          : ''
      }`}
      aria-label="Audio file drop zone"
    >
      <div
        className={`mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-400 shadow-lg shadow-indigo-500/30 transition-transform duration-200 ${
          dragging ? 'scale-110' : ''
        }`}
        aria-hidden
      >
        <Music size={30} className="text-white" />
      </div>

      <p className="eyebrow mb-2">01 · Load audio</p>
      <h2 className="text-2xl font-bold text-white sm:text-3xl">
        {dragging ? 'Drop it — we’ll take it from here' : 'Drop your track to start slicing'}
      </h2>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-400 sm:text-base">
        Select a section, preview the loop, save it, export it. Everything runs on your
        device — your audio never leaves this browser.
      </p>

      <button type="button" onClick={onBrowse} className="btn btn-primary mx-auto mt-7 !px-7 !py-3 !text-sm">
        <Upload size={16} aria-hidden />
        Browse files
      </button>

      <p className="mt-4 text-xs text-slate-500">
        Supports MP3 · WAV · OGG · FLAC · M4A · AAC · WebM
      </p>

      {/* Mini workflow strip — the whole app in five words */}
      <ol className="mt-8 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-2" aria-label="Workflow">
        {STEPS.map((step, i) => (
          <li key={step} className="flex items-center gap-1.5">
            <span className="chip !text-[10px]">
              <span className="font-mono text-indigo-400">{i + 1}</span>
              {step}
            </span>
            {i < STEPS.length - 1 && (
              <ArrowRight size={12} className="hidden text-slate-600 sm:block" aria-hidden />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
