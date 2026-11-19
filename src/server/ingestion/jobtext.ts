import { parse } from 'node-html-parser';
import { htmlToText } from './normalize';

/** A page text shorter than this is not a job description. */
const MIN_TEXT_LENGTH = 200;

/** Finds the job text in a posting page. It tries structured data first, then the main content. */
export function extractJobText(html: string): string | null {
  const root = parse(html);
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.text);
      const items = Array.isArray(data) ? data : data['@graph'] ?? [data];
      for (const item of items) {
        if (item && item['@type'] === 'JobPosting' && typeof item.description === 'string') {
          const text = htmlToText(item.description);
          if (text.length >= MIN_TEXT_LENGTH) return text;
        }
      }
    } catch {
      // Not valid JSON. Try the next source.
    }
  }
  // The parser finds no body element in some pages. The whole document is the last candidate.
  for (const selector of ['main', 'article', '[role="main"]', '#job-description', '.job-description', 'body', null]) {
    const node = selector ? root.querySelector(selector) : root;
    if (!node) continue;
    for (const junk of node.querySelectorAll('head, script, style, nav, header, footer, noscript, svg')) junk.remove();
    // A search form or a login form is not job text. Some systems put the whole page in one form, and that form stays.
    const whole = node.text.length;
    for (const form of node.querySelectorAll('form')) if (form.text.length < whole / 2) form.remove();
    const text = htmlToText(node.innerHTML);
    if (text.length >= MIN_TEXT_LENGTH) return text.slice(0, 20_000);
  }
  return null;
}
