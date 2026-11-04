/** Splits a heading around the words picked for emphasis. Words it can't find are simply not emphasised. */
export function splitHighlight(text, match) {
  const at = match ? text.indexOf(match) : -1;
  if (at < 0) return { before: text, match: '', after: '' };
  return { before: text.slice(0, at), match, after: text.slice(at + match.length) };
}

/** The `highlight` option for SplitReveal, or nothing when no words were picked. */
export const highlightOf = (match, wrap) => (match ? { match, wrap } : undefined);
