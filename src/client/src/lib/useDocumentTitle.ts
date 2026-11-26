import { useEffect } from 'react';

const NAME = 'sieve';

/** The titles of the mounted calls, in the order they were set. The last one shows. */
const titles: Array<{ title: string }> = [];

function show(): void {
  const title = titles.at(-1)?.title;
  document.title = title ? `${title} · ${NAME}` : NAME;
}

/**
 * Sets the document title to "<title> · sieve", or to "sieve" for an empty title.
 *
 * Call it once per page. A page that shows an open posting passes the posting's title instead of its own.
 * When several calls are mounted, the one whose title was set last wins. When it unmounts, the title of
 * the call before it shows again. React runs the effects of a child before those of its parent, so a
 * child and a parent that both set a title on the first render show the parent's.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const entry = { title };
    titles.push(entry);
    show();
    return () => {
      titles.splice(titles.indexOf(entry), 1);
      show();
    };
  }, [title]);
}
