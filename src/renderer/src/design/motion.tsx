import { useEffect, useRef, useState } from 'react';

const query = '(prefers-reduced-motion: reduce)';

/** True when the person has asked their computer for less motion. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Rolls a number up to its value once, the first time it's shown. Later
 * changes jump straight to the new value so edits never feel laggy.
 */
export function useCountUp(target: number, durationMs = 900, delayMs = 0): number {
  const reduced = useReducedMotion();
  const played = useRef(false);
  const [v, setV] = useState(() => (reduced ? target : 0));
  useEffect(() => {
    if (reduced || played.current) {
      setV(target);
      return;
    }
    played.current = true;
    let raf = 0;
    const t0 = performance.now() + delayMs;
    const step = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - t0) / durationMs));
      setV(target * easeOut(t));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, delayMs, reduced]);
  return v;
}

/** A formatted number string that rolls up; non-numeric strings are shown as they are. */
export function CountUp({ text, delayMs = 0 }: { text: string; delayMs?: number }) {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  const target = m ? Number(text) : 0;
  const digits = m?.[3]?.length ?? 0;
  const v = useCountUp(Math.abs(target), 900, delayMs);
  if (!m) return <>{text}</>;
  return (
    <>
      {m[1]}
      {v.toFixed(digits)}
    </>
  );
}
