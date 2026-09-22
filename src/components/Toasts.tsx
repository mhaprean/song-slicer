import { createPortal } from 'react-dom';
import { X, CheckCircle2, Info, AlertTriangle } from 'lucide-react';
import type { Toast } from '../types/models';

const KIND_STYLE: Record<Toast['kind'], { border: string; icon: JSX.Element }> = {
  info: {
    border: 'border-l-indigo-400',
    icon: <Info size={16} className="text-indigo-300 mt-0.5 shrink-0" aria-hidden />,
  },
  success: {
    border: 'border-l-emerald-400',
    icon: <CheckCircle2 size={16} className="text-emerald-300 mt-0.5 shrink-0" aria-hidden />,
  },
  error: {
    border: 'border-l-rose-400',
    icon: <AlertTriangle size={16} className="text-rose-300 mt-0.5 shrink-0" aria-hidden />,
  },
};

export default function Toasts({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return createPortal(
    <div
      className="fixed right-3 top-16 z-[60] flex w-[calc(100vw-1.5rem)] max-w-sm flex-col gap-2 pointer-events-none"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const style = KIND_STYLE[t.kind];
        return (
          <div
            key={t.id}
            className={`toast pointer-events-auto flex items-start gap-2.5 rounded-xl border border-white/10 border-l-2 bg-[#0b1020]/95 py-2.5 pl-3 pr-2 shadow-xl shadow-black/40 backdrop-blur-md ${style.border}`}
          >
            {style.icon}
            <p className="min-w-0 flex-1 break-words text-sm leading-snug text-slate-200">
              {t.message}
            </p>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action?.run();
                  onDismiss(t.id);
                }}
                className="btn btn-ghost !min-h-0 !px-2 !py-1 !text-xs !text-indigo-300 hover:!text-indigo-200"
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              aria-label="Dismiss notification"
              className="icon-btn !h-7 !w-7"
            >
              <X size={14} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>,
    document.body
  );
}
