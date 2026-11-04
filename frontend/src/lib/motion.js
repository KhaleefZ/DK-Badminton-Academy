import { useReducedMotion } from 'motion/react';

// Same curves as --ease-out / --ease-in-out in tokens.css, as Motion cubic-bezier arrays.
export const EASE_OUT = [0.23, 1, 0.32, 1];
export const EASE_IN_OUT = [0.77, 0, 0.175, 1];

/**
 * Returns a function that keeps a transform string, or drops it to 'none' when the
 * user prefers reduced motion — so animations become a plain fade instead of disappearing.
 * Use full transform strings (not x/y/scale) so Motion stays on the GPU path.
 */
export function useMotionTransform() {
  const reduce = useReducedMotion();
  return (value) => (reduce ? 'none' : value);
}
