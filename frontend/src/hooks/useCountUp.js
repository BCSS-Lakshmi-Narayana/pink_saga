import { useEffect, useRef, useState } from 'react';

/**
 * Subtle count-up animation for KPI numbers. Skips the animation entirely
 * when the value isn't a finite number (labels, "—", etc.) or the user has
 * requested reduced motion.
 */
const prefersReducedMotion = () => (
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
);

const useCountUp = (value, { duration = 500 } = {}) => {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const frameRef = useRef(null);

  useEffect(() => {
    const target = Number(value);
    if (!Number.isFinite(target) || prefersReducedMotion()) {
      setDisplay(value);
      fromRef.current = target;
      return undefined;
    }

    const from = Number.isFinite(fromRef.current) ? fromRef.current : target;
    const start = performance.now();

    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) * (1 - progress); // ease-out
      setDisplay(Math.round(from + (target - from) * eased));
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [value, duration]);

  return display;
};

export default useCountUp;
