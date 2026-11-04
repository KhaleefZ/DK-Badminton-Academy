import { MaskReveal, Parallax } from '../motion';
import { imageSrc, useContent } from '../lib/site';

/**
 * A photo chosen in the admin panel. Concept photography carries the "not the venue" disclosure.
 * Motion options (see docs/motion-plan.md): `reveal` wipes the image open from a direction,
 * `parallax` drifts it with scroll (px), `overlay` draws on top (e.g. <CourtLines />).
 */
export default function ConceptImage({ image, height, className = '', eager = false, reveal, parallax, overlay }) {
  const { brand } = useContent();
  const src = imageSrc(image);
  if (!src) return null;
  let media = <img src={src} alt={image.alt} loading={eager ? 'eager' : 'lazy'} decoding="async" />;
  if (parallax) media = <Parallax offset={parallax}>{media}</Parallax>;
  if (reveal) {
    media = (
      <MaskReveal direction={reveal} trigger={eager ? 'mount' : 'view'}>
        {media}
      </MaskReveal>
    );
  }

  return (
    <figure className={`concept-image ${className}`} style={height ? { '--image-height': `${height}px` } : undefined}>
      {media}
      {overlay && <div className="concept-image__overlay">{overlay}</div>}
      {image.concept && brand.imageDisclosure && <figcaption className="concept-image__disclosure">{brand.imageDisclosure}</figcaption>}
    </figure>
  );
}
