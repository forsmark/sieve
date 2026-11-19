import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = { x: 72, top: 84, bottom: 72 };
const SIZE = 11;
const LINE = 16;

const REPLACEMENTS: Record<string, string> = { '→': '->', '−': '-', '‑': '-', ' ': ' ', ' ': ' ', ' ': ' ', '\t': '    ' };

/** The standard PDF fonts cover Western European text. A character outside that set becomes "?". */
function encodable(text: string, font: PDFFont): string {
  let out = '';
  for (const ch of text) {
    const c = REPLACEMENTS[ch] ?? ch;
    try {
      font.encodeText(c);
      out += c;
    } catch {
      out += '?';
    }
  }
  return out;
}

function wrap(paragraph: string, font: PDFFont, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of paragraph.split(/ +/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, SIZE) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  lines.push(line);
  return lines;
}

/** Renders a letter as an A4 PDF with selectable text. */
export async function renderLetterPdf(text: string, meta: { title: string }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.setTitle(encodable(meta.title, font));
  doc.setCreator('sieve');
  const maxWidth = PAGE.width - 2 * MARGIN.x;
  let page = doc.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN.top;
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const lines = raw.trim() === '' ? [''] : wrap(encodable(raw.trim(), font), font, maxWidth);
    for (const line of lines) {
      if (y < MARGIN.bottom) {
        page = doc.addPage([PAGE.width, PAGE.height]);
        y = PAGE.height - MARGIN.top;
      }
      if (line) page.drawText(line, { x: MARGIN.x, y, size: SIZE, font });
      y -= LINE;
    }
  }
  return doc.save();
}

export function letterFileName(company: string, title: string): string {
  const slug = `${company} ${title}`
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .toLowerCase();
  return `cover-letter-${slug || 'posting'}.pdf`;
}
