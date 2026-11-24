import { Fragment } from 'react';
import { useParams } from 'react-router-dom';
import ConceptImage from '../components/ConceptImage';
import NotFound from './NotFound';
import { imageSrc, useContent } from '../lib/site';

const isHeading = (block) => block.startsWith('## ');
// A block where every line starts with "- " is a bulleted list.
const isList = (block) => block.split('\n').every((line) => /^\s*- /.test(line));

/** "**words**" become bold. Built from React elements only, so text typed in the admin panel can't inject HTML. */
function Inline({ text }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part}</Fragment>));
}

/**
 * A page written in the admin panel. A blank line starts a new paragraph, "## " starts a heading,
 * lines starting with "- " make a bulleted list, and **text** is bold.
 */
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
        {blocks.map((block, i) => {
          if (isHeading(block)) {
            return (
              <h2 key={i} className="display display--sm">
                {block.slice(3)}
              </h2>
            );
          }
          if (isList(block)) {
            return (
              <ul key={i} className="body custom-page__text custom-page__list">
                {block.split('\n').map((line, j) => (
                  <li key={j}>
                    <Inline text={line.replace(/^\s*- /, '')} />
                  </li>
                ))}
              </ul>
            );
          }
          return (
            <p key={i} className="body custom-page__text">
              <Inline text={block} />
            </p>
          );
        })}
      </div>
    </section>
  );
}
