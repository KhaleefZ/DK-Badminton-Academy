import { DrawPath } from '../motion';

// Signature motif: court markings draw themselves over the photography, in rally lime.
// Coordinates are percentages of the image (viewBox 0–100, stretched to fit), so the
// stroke width is in those units too.
const LAYOUTS = {
  // Floor of the hero shot: baseline, service line and centre line.
  hero: ['M4 93 L96 93', 'M12 80 L88 80', 'M50 80 L50 93'],
  // Arched hall: court boundary converging toward the far net, plus centre line.
  hall: ['M8 98 L36 64', 'M92 98 L64 64', 'M36 64 L64 64', 'M50 64 L50 98'],
};

export default function CourtLines({ layout = 'hero', delay = 0.9, trigger = 'mount' }) {
  return (
    <DrawPath
      className="court-lines"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      paths={LAYOUTS[layout]}
      stroke="var(--accent-rally)"
      strokeWidth={0.45} // viewBox units ≈ 2–3px at hero size
      duration={0.9}
      stagger={0.35}
      delay={delay}
      trigger={trigger}
    />
  );
}
