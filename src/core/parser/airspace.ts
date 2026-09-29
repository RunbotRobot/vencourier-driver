import type { Cargo, Job, Reference } from '../types';
import { DEFAULT_TZ, zonedToIso } from '../time';
import {
  cleanLine, extractSignature, isImagePlaceholder, isEmptyValue, parseAddressBlock, parseContact, toLines, zoneFromAbbr,
} from './text';

/** Headings in the Airspace pickup-dispatch template. Content follows on later lines. */
const HEADINGS: [key: string, re: RegExp][] = [
  ['pickupAt', /^PICKUP AT:?$/i],
  ['pickupNotes', /^PICKUP INSTRUCTIONS:?$/i],
  ['deliverBy', /^DELIVER BY:?$/i],
  ['deliveryNotes', /^DELIVERY INSTRUCTIONS:?$/i],
  ['orderDetails', /^Order details$/i],
  ['refs', /^ORDER REFERENCES:?$/i],
  ['pickupAddress', /^PICKUP ADDRESS:?$/i],
  ['pickupContact', /^PICKUP CONTACT:?$/i],
  ['deliveryAddress', /^DELIVERY ADDRESS:?$/i],
  ['deliveryContact', /^DELIVERY CONTACT:?$/i],
  ['kindRegards', /^(Kind regards|Regards|Sincerely|Thanks|Thank you),?$/i],
];

export function looksLikeAirspace(text: string, subject = ''): boolean {
  return /PICKUP ADDRESS:/i.test(text) && /DELIVERY ADDRESS:/i.test(text) && /Order #/i.test(text + subject);
}

/** "Sep 25, 2026, 11:35 PDT" -> ISO. Falls back to raw text if unparseable. */
export function parseAirspaceTime(s: string): { iso?: string; text: string } {
  const text = cleanLine(s);
  const m = text.match(/^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4}),? (\d{1,2}):(\d{2})(?:\s*([AP]M))?\s*([A-Z]{2,5})?$/i);
  if (!m) return { text };
  const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
    .indexOf(m[1]!.slice(0, 3).toLowerCase());
  if (month < 0) return { text };
  let h = Number(m[4]);
  const ap = m[6]?.toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  const tz = (m[7] && zoneFromAbbr(m[7])) || DEFAULT_TZ;
  return { iso: zonedToIso(Number(m[3]), month + 1, Number(m[2]), h, Number(m[5]), tz), text };
}

const BOILERPLATE_SENTENCES = [
  /^Please see details below for an order we seek coverage on\.?$/i,
  /^Reply to this email to confirm coverage and provide driver ETA and transit time before dispatching\.?$/i,
];
const BOILERPLATE_LINES = [
  /^\[[^\]]*\]$/, // [logo] / [image] placeholders
  /^Order #\s*\d+$/i,
  /^Dear .*,?$/i,
  /^Upon confirmation, all communication will go through the Airspace Partner Portal\.?/i,
];

export function parseAirspace(
  input: { subject: string; text: string },
): Omit<Job, 'id' | 'status' | 'step' | 'timeline' | 'attachments' | 'thread' | 'source'> & { parser: 'airspace' } {
  const { rest, dispatcher } = extractSignature(toLines(input.text).filter((l) => !isImagePlaceholder(l)));

  // Split into heading-keyed sections; everything before the first heading is "preamble".
  const sections: Record<string, string[]> = { preamble: [] };
  let cur = 'preamble';
  for (const raw of rest) {
    const line = cleanLine(raw);
    const h = HEADINGS.find(([, re]) => re.test(line));
    if (h) { cur = h[0]; sections[cur] ??= []; continue; }
    (sections[cur] ??= []).push(raw);
  }
  const body = (k: string) => (sections[k] ?? []).map(cleanLine).filter(Boolean);

  const notesParts: string[] = [];
  const references: Reference[] = [];
  let portalUrl: string | undefined;

  // Header "Tracking ID: X, Order #: N - Pickup Dispatch"
  const header = rest.map(cleanLine).find((l) => /^Tracking ID:/i.test(l)) ?? '';
  const tracking = header.match(/Tracking ID:\s*([A-Z0-9-]+)/i)?.[1];
  const orderNumber =
    header.match(/Order #:?\s*(\d+)/i)?.[1] ?? input.subject.match(/\b(\d{5,})\b/)?.[1] ?? rest.join(' ').match(/Order #\s*(\d+)/i)?.[1];
  if (tracking) references.push({ label: 'Tracking ID', value: tracking });

  // Preamble: keep any non-boilerplate sentences.
  for (const l of body('preamble')) {
    if (/^Tracking ID:/i.test(l) || BOILERPLATE_LINES.some((re) => re.test(l))) continue;
    const kept = l.split(/(?<=\.)\s+/).filter((s) => !BOILERPLATE_SENTENCES.some((re) => re.test(s.trim())));
    if (kept.length) notesParts.push(kept.join(' '));
  }

  // Order details area: portal link, then references
  for (const raw of sections.orderDetails ?? []) {
    const url = raw.match(/https?:\/\/[^\s>]+/)?.[0];
    if (url) portalUrl = url;
    if (!url && !BOILERPLATE_LINES.some((re) => re.test(cleanLine(raw))) && cleanLine(raw)) notesParts.push(cleanLine(raw));
  }
  for (const l of body('refs')) {
    const m = l.match(/^([^:]{1,40}):\s*(.+)$/);
    if (m) references.push({ label: m[1]!.trim(), value: m[2]!.trim() });
    else notesParts.push(l);
  }
  for (const l of body('kindRegards')) if (!/^Kind regards/i.test(l)) notesParts.push(l);

  // The cargo block has no heading, so it trails the last contact section; pull it out by pattern.
  const isCargoLine = (l: string) =>
    /^(VEHICLE TYPE|DANGEROUS GOODS|TOTAL PIECES|TOTAL WEIGHT|Commodity|IDs?):/i.test(l) || /^\d+ of [\d.]+ x /i.test(l);
  const withoutCargo = (k: string) => (sections[k] ?? []).filter((l) => !isCargoLine(cleanLine(l)));
  const pickupContactLines = withoutCargo('pickupContact');
  const deliveryContactLines = withoutCargo('deliveryContact');

  const cargo: Cargo = {};
  const dims: string[] = [];
  for (const l of rest.map(cleanLine).filter(isCargoLine)) {
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^VEHICLE TYPE:\s*(.+)$/i))) cargo.vehicleType = m[1];
    else if ((m = l.match(/^DANGEROUS GOODS:\s*(.+)$/i))) cargo.dangerousGoods = m[1];
    else if ((m = l.match(/^TOTAL PIECES:\s*(\d+)/i))) cargo.pieces = Number(m[1]);
    else if ((m = l.match(/^TOTAL WEIGHT:\s*(.+)$/i))) cargo.weight = m[1];
    else if ((m = l.match(/^Commodity:\s*(.+)$/i))) cargo.commodity = m[1];
    else if ((m = l.match(/^IDs?:\s*(.+)$/i))) cargo.pieceIds = m[1]!.split(/[,\s]+/).filter(Boolean);
    else dims.push(l);
  }
  if (dims.length) cargo.dimensions = dims.join('; ');

  const pu = parseAddressBlock(body('pickupAddress'));
  const de = parseAddressBlock(body('deliveryAddress'));
  const puTime = parseAirspaceTime(body('pickupAt')[0] ?? '');
  const deTime = parseAirspaceTime(body('deliverBy')[0] ?? '');
  const puNotes = body('pickupNotes').join('\n');
  const deNotes = body('deliveryNotes').join('\n');

  const name = input.subject.replace(/^((re|fw|fwd):\s*)+/i, '').replace(/^\s*\d{5,}\s*[-–:]?\s*/, '').trim()
    || `${pu.name ?? 'Pickup'} to ${de.name ?? 'Delivery'}`;

  return {
    name,
    orderNumber,
    references,
    pickup: {
      place: { ...pu, contact: parseContact(pickupContactLines), kind: 'ground' },
      time: puTime.iso, timeText: puTime.iso ? undefined : puTime.text || undefined,
      notes: isEmptyValue(puNotes) ? undefined : puNotes,
    },
    delivery: {
      place: { ...de, contact: parseContact(deliveryContactLines), kind: 'ground' },
      time: deTime.iso, timeText: deTime.iso ? undefined : deTime.text || undefined,
      notes: isEmptyValue(deNotes) ? undefined : deNotes,
    },
    cargo,
    dispatcher,
    portalUrl,
    notes: notesParts.join('\n'),
    parser: 'airspace',
  };
}
