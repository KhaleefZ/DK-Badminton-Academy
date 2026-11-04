// Shared curves (mirror these as CSS custom properties in the project's tokens):
//   --ease-out: cubic-bezier(0.23, 1, 0.32, 1)
//   --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)
export const EASE_OUT = [0.23, 1, 0.32, 1];
export const EASE_IN_OUT = [0.77, 0, 0.175, 1];

// Default in-view trigger: fire once, a little after the element enters.
export const VIEWPORT = { once: true, margin: '0px 0px -12% 0px' };

// Real pointer (mouse/trackpad) — gate hover/magnetic effects with this.
export const hasFinePointer = () =>
  typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
