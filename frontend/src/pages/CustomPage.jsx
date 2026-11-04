import { useParams } from 'react-router-dom';
import ConceptImage from '../components/ConceptImage';
import NotFound from './NotFound';
import { imageSrc, useContent } from '../lib/site';

const isHeading = (block) => block.startsWith('## ');

/** A page written in the admin panel. A blank line starts a new paragraph, and "## " starts a heading. */
export default function CustomPage() {
  const { slug } = useParams();
  const page = useContent().customPages.find((p) => p.slug === slug && p.visible);
  if (!page) return <NotFound />;
  const blocks = page.body.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);

  return (
    <section className="section" aria-labelledby="custom-page-heading">
      <div className="container stack custom-page" style={{ '--stack-gap': '24px' }}>
        {page.overline && <p className="overline">{page.overline}</p>}
        <h1 id="custom-page-heading" className="display display--page">
          {page.title}
        </h1>
        {imageSrc(page.image) && <ConceptImage image={page.image} height={420} className="full-width" />}
        {blocks.map((block, i) =>
          isHeading(block) ? (
            <h2 key={i} className="display display--sm">
              {block.slice(3)}
            </h2>
          ) : (
            <p key={i} className="body custom-page__text">
              {block}
            </p>
          ),
        )}
      </div>
    </section>
  );
}
