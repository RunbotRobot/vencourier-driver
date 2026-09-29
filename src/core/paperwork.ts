import { PDFDocument } from 'pdf-lib';

export interface PdfDoc { name: string; pageCount: number }
export interface PrintItem {
  name: string;
  /** 1-based page numbers, in print order. */
  pages: number[];
  copies: number;
  reason: string;
}

export interface PaperworkHints {
  /** Text of the job email and dispatch replies: instructions like "print the last page of the alert". */
  text: string;
  pieces?: number;
}

/**
 * Decides which pages to print, from what dispatch wrote. The plan is a starting point the driver
 * can edit before generating; every item carries its reason. Unrecognised PDFs default to
 * "all pages, one copy" so nothing needed is silently left out.
 */
export function planPaperwork(docs: PdfDoc[], hints: PaperworkHints): PrintItem[] {
  const lastPageAll = /last page of the (?:alert|pre-?alert)[^.]*print/i.test(hints.text)
    || /print[^.]*last page of the (?:alert|pre-?alert)/i.test(hints.text);
  const affixAll = /affix(?:ed)? to (?:all|each|every) (?:box|piece|package)/i.test(hints.text);
  const copies = affixAll && hints.pieces ? hints.pieces : 1;
  const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

  return docs.map((d): PrintItem => {
    const isAlert = /alert/i.test(d.name) || /^\d{6,}\.pdf$/i.test(d.name);
    if (lastPageAll && isAlert && d.pageCount > 0) {
      return { name: d.name, pages: [d.pageCount], copies, reason: `Dispatch: print the last page of the alert${affixAll ? ' and affix to every box' : ''}` };
    }
    if (/awb editor/i.test(d.name)) {
      return { name: d.name, pages: [], copies: 0, reason: 'Used to tender digitally — not printed unless you add pages' };
    }
    if (/\b(mawb|hawb|awb|bol|label|LB)\b/i.test(d.name)) {
      return { name: d.name, pages: range(d.pageCount), copies: 1, reason: 'Shipping document — all pages' };
    }
    return { name: d.name, pages: range(d.pageCount), copies: 1, reason: 'Unrecognised — all pages (edit if not needed)' };
  });
}

/** Merges only the selected pages into one PDF, ready to print. */
export async function buildPrintPdf(items: (PrintItem & { bytes: Uint8Array })[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const it of items) {
    if (!it.pages.length || it.copies < 1) continue;
    const src = await PDFDocument.load(it.bytes, { ignoreEncryption: true });
    for (let c = 0; c < it.copies; c++) {
      const pages = await out.copyPages(src, it.pages.map((p) => p - 1));
      pages.forEach((p) => out.addPage(p));
    }
  }
  if (out.getPageCount() === 0) throw new Error('Nothing selected to print');
  return out.save();
}

/** "1-3, 5" -> [1,2,3,5], clamped to the document. */
export function parsePageRange(input: string, pageCount: number): number[] {
  const pages = new Set<number>();
  for (const part of input.split(',')) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2] ?? m[1]);
    for (let p = Math.min(a, b); p <= Math.max(a, b); p++) if (p >= 1 && p <= pageCount) pages.add(p);
  }
  return [...pages];
}
