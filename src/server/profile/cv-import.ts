import { extractText, getDocumentProxy } from 'unpdf';
import { htmlToText } from '../ingestion/normalize';

export class CvImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CvImportError';
  }
}

const MIN_TEXT_LENGTH = 40;

/** Returns the text of a CV file. Accepts a text-based PDF, a Markdown file, or plain text. */
export async function extractCvText(file: { name: string; type?: string; bytes: Uint8Array }): Promise<string> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf') || startsWithPdfMagic(file.bytes);
  let text: string;
  if (isPdf) {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(file.bytes));
      const result = await extractText(pdf, { mergePages: true });
      text = Array.isArray(result.text) ? result.text.join('\n') : result.text;
    } catch {
      throw new CvImportError('The PDF could not be read. Upload a text-based PDF, a Markdown file, or paste the text.');
    }
  } else {
    text = new TextDecoder('utf-8', { fatal: false }).decode(file.bytes);
    if (text.includes('\u0000')) throw new CvImportError('The file is not a text document. Upload a text-based PDF, a Markdown file, or paste the text.');
    if (/\.html?$/i.test(file.name)) text = htmlToText(text);
  }
  return cleanCvText(text);
}

export function cleanCvText(text: string): string {
  const clean = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (clean.replace(/\s/g, '').length < MIN_TEXT_LENGTH) {
    throw new CvImportError('The document has no readable text. The system needs a text-based document.');
  }
  return clean;
}

function startsWithPdfMagic(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}
