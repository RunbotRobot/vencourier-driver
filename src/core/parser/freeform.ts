import type { Cargo, Job, Reference } from '../types';
import { AIRLINE_RE, cleanLine, extractSignature, isImagePlaceholder, parseAddressBlock, toLines } from './text';

type Parsed = Omit<Job, 'id' | 'status' | 'step' | 'timeline' | 'attachments' | 'thread' | 'source'>;

const PICKUP_BLOCK = /^(pick ?-?up)\s*(address|location)\s*:?\s*$/i;
const DELIVERY_BLOCK = /^(deliver(y)?|drop ?-?off)\s*(address|location)\s*:?\s*$/i;

/** Order number / name from subjects like "SD0024780 / 9273765 (VasAero-Kent to UA)". */
export function parseSubject(subject: string): { orderNumber?: string; references: Reference[]; name: string } {
  const s = subject.replace(/^((re|fw|fwd):\s*)+/gi, '').trim();
  const ids = [...s.matchAll(/\b([A-Z]{0,3}\d{5,})\b/g)].map((m) => m[1]!);
  const paren = s.match(/\(([^)]+)\)/)?.[1];
  let name = paren ?? s;
  if (!paren) {
    for (const id of ids) name = name.replace(id, '');
    name = name.replace(/[/#-]\s*(?=[/#-]|$)/g, '').replace(/^\W+|\W+$/g, '').replace(/\s+/g, ' ');
  }
  return {
    orderNumber: ids[0],
    references: ids.slice(1).map((value) => ({ label: 'Reference', value })),
    name: name.trim() || s,
  };
}

/** Heuristic parse for dispatcher-written emails with no fixed template. Nothing is dropped: leftovers become notes. */
export function parseFreeform(input: { subject: string; text: string }): Parsed & { parser: 'freeform' } {
  const { rest, dispatcher } = extractSignature(toLines(input.text).filter((l) => !isImagePlaceholder(l)));
  const subj = parseSubject(input.subject);
  const consumed = new Set<number>();
  const references: Reference[] = [...subj.references];
  const cargo: Cargo = {};

  const block = (re: RegExp) => {
    const i = rest.findIndex((l) => re.test(cleanLine(l)));
    if (i < 0) return undefined;
    consumed.add(i);
    const lines: string[] = [];
    for (let j = i + 1; j < rest.length && cleanLine(rest[j] ?? ''); j++) {
      lines.push(rest[j]!);
      consumed.add(j);
    }
    return parseAddressBlock(lines);
  };
  const pu = block(PICKUP_BLOCK);
  const de = block(DELIVERY_BLOCK);

  rest.forEach((raw, i) => {
    const l = cleanLine(raw);
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^Dims?(?:ensions)?:\s*(.+)$/i))) { cargo.dimensions = m[1]; consumed.add(i); }
    else if ((m = l.match(/^Weight:\s*(.+)$/i))) { cargo.weight = m[1]; consumed.add(i); }
    else if ((m = l.match(/^(?:Pieces|Pcs|Qty|Quantity):\s*(\d+)/i))) { cargo.pieces = Number(m[1]); consumed.add(i); }
    else if ((m = l.match(/^Commodity:\s*(.+)$/i))) { cargo.commodity = m[1]; consumed.add(i); }
    else if ((m = l.match(/^Pick ?-?up ref(?:erence)?\s*#?\s*[:(]?\s*(.+?)\)?$/i))) {
      references.push({ label: 'Pickup ref', value: m[1]!.replace(/^JOB#\s*/i, 'JOB# ').trim() });
      consumed.add(i);
    } else if (/^\[[^\]]*\]$/.test(l) || /^Dear (all|team|driver)[,.!]*$/i.test(l) || /^Thank you!?$/i.test(l)) consumed.add(i);
  });

  const notes = rest
    .filter((_, i) => !consumed.has(i))
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const [subjPickup, subjDelivery] = subj.name.split(/\s+to\s+/i);
  const airline = AIRLINE_RE.test(input.text);
  const deliveryAirline = /\btender|lock ?-?out|to (UA|AA|DL|AS)\b|air ?cargo/i.test(input.text);
  const pickupAirline = /\brecover|from (UA|AA|DL|AS)\b/i.test(input.text);

  return {
    name: subj.name,
    orderNumber: subj.orderNumber,
    references,
    pickup: { place: { name: pu?.name ?? subjPickup?.trim(), address: pu?.address, kind: pickupAirline ? 'airline' : 'ground' } },
    delivery: {
      place: { name: de?.name ?? subjDelivery?.trim(), address: de?.address, kind: deliveryAirline || (airline && !de) ? 'airline' : 'ground' },
    },
    cargo,
    dispatcher,
    notes,
    parser: 'freeform',
  };
}
