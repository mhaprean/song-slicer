import { useEffect, useRef } from 'react';
import { formatTimeMs } from '../utils/audioExport';

/** Coarse pointers (touch) get a much larger grab area. */
const COARSE =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: coarse)').matches;

interface LoopPinProps {
  side: 'start' | 'end';
  time: number;
  duration: number;
  /** Waveform pixel height — pins overlay only the wave, not the time ruler. */
  height: number;
  onPointerDown: (side: 'start' | 'end', e: PointerEvent) => void;
  onFocus?: (side: 'start' | 'end') => void;
  onBlur?: (side: 'start' | 'end') => void;
}

/**
 * Draggable loop marker portaled INSIDE the WaveSurfer wrapper (shadow root),
 * positioned as a % of the timeline so it stays anchored to the same audio
 * second at any zoom level. Inline styles only — outer CSS can't reach shadow DOM.
 * Implements slider semantics so screen readers and keyboards can reach it.
 */
export default function LoopPin({
  side,
  time,
  duration,
  height,
  onPointerDown,
  onFocus,
  onBlur,
}: LoopPinProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    const down = (e: Event) => onPointerDown(side, e as PointerEvent);
    const focus = () => onFocus?.(side);
    const blur = () => onBlur?.(side);

    el.addEventListener('pointerdown', down);
    // Keep WaveSurfer from seeking when clicking/double-clicking a pin
    el.addEventListener('click', stop);
    el.addEventListener('dblclick', stop);
    el.addEventListener('focus', focus);
    el.addEventListener('blur', blur);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('click', stop);
      el.removeEventListener('dblclick', stop);
      el.removeEventListener('focus', focus);
      el.removeEventListener('blur', blur);
    };
  }, [side, onPointerDown, onFocus, onBlur]);

  const pct = duration > 0 ? (time / duration) * 100 : 0;
  const isStart = side === 'start';
  const color = isStart ? '#38bdf8' : '#a78bfa';
  const width = COARSE ? 30 : 18;
  const knob = COARSE ? 18 : 14;

  return (
    <div
      ref={ref}
      data-pin={side}
      role="slider"
      tabIndex={0}
      aria-label={isStart ? 'Loop start' : 'Loop end'}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration * 1000) / 1000}
      aria-valuenow={Math.round(time * 1000) / 1000}
      aria-valuetext={`${formatTimeMs(time)} — ${isStart ? 'loop start' : 'loop end'}`}
      style={{
        position: 'absolute',
        top: 0,
        height,
        width,
        left: `calc(${pct}% - ${width / 2}px)`,
        cursor: 'ew-resize',
        zIndex: 10,
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      {/* Handle line */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          marginLeft: '-1px',
          top: 0,
          bottom: 0,
          width: '2px',
          background: color,
          opacity: 0.9,
        }}
      />
      {/* Knob */}
      <div
        style={{
          position: 'absolute',
          top: '4px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: knob,
          height: knob,
          borderRadius: '50%',
          background: color,
          border: '2px solid #05070f',
          boxShadow: '0 2px 6px rgba(2, 6, 23, 0.7)',
        }}
      />
      {/* Floating time label — anchored to the handle line and flipped inward
          near the timeline edges so it never clips (pin left goes negative at 0%) */}
      <div
        style={{
          position: 'absolute',
          top: `${(COARSE ? 26 : 24)}px`,
          ...(isStart
            ? pct > 80
              ? { right: '50%' }
              : { left: '50%' }
            : pct < 20
              ? { left: '50%' }
              : { right: '50%' }),
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: COARSE ? '11px' : '10px',
          lineHeight: '14px',
          padding: '1px 6px',
          borderRadius: '6px',
          background: 'rgba(2, 6, 23, 0.88)',
          border: `1px solid ${color}55`,
          color,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          fontWeight: 600,
        }}
      >
        {formatTimeMs(time)}
      </div>
    </div>
  );
}
