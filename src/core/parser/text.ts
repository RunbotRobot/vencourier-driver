import type { Contact, Dispatcher } from '../types';

export const PHONE_RE = /\+?\d[\d\s().-]{6,}\d/;

export function cleanLine(line: string): string {
  return line
    .replace(/<tel:[^>]*>/gi, '')
    .replace(/<mailto:[^>]*>/gi, '')
    .replace(/<https?:\/\/[^>]*>/gi, '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function phoneOf(line: string): string | undefined {
  return cleanLine(line).match(PHONE_RE)?.[0]?.trim();
}

export function toLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

/** "Darren L. Mitchell Jr." — a few capitalised words, so a body sentence ending in "." is not mistaken for a name. */
const isNameLike = (l: string) => {
  const words = l.split(' ');
  return words.length <= 4 && words.every((w) => /^[A-Z]/.test(w));
};

/** Image placeholders such as "[logo]" or "[Unknown.jpeg]" that mail clients leave in plain text. */
export const isImagePlaceholder = (l: string) => /^\[[^\]]*\]$/.test(l.trim());

const TITLE_RE = /dispatch|assistant|manager|coordinator|agent|supervisor|operations/i;

/**
 * Finds a dispatcher signature block ("Name / Title / Email: … / Dispatch #: …")
 * and removes it from the text. Returns the remaining lines.
 */
export function extractSignature(lines: string[]): { rest: string[]; dispatcher?: Dispatcher } {
  const emailIdx = lines.findIndex((l) => /^\s*Email:/i.test(l) && /mailto:|@/i.test(l));
  if (emailIdx < 0) return { rest: lines };

  let start = emailIdx;
  // walk back over the title and up to two name lines
  while (start > 0 && emailIdx - start < 3) {
    const prev = cleanLine(lines[start - 1] ?? '');
    if (!prev || prev.length > 60 || /[!?:,;]$/.test(prev) || !(/\.$/.test(prev) ? isNameLike(prev) : true)) break;
    start--;
  }
  let end = emailIdx + 1;
  while (end < lines.length && /^\s*(Dispatch|Personal|Work|Cell|Phone|Office|Fax|Tel)[^:]*#?:/i.test(lines[end] ?? '')) end++;

  const block = lines.slice(start, end);
  const head = block.slice(0, emailIdx - start).map(cleanLine).filter(Boolean);
  const titleIdx = head.findIndex((l) => TITLE_RE.test(l));
  const name = head.find((l, i) => i !== titleIdx && !TITLE_RE.test(l));
  const emails = [...block.join('\n').matchAll(/mailto:([^>\s]+)/gi)].map((m) => m[1]!);
  const phones = block.slice(emailIdx - start + 1).map(phoneOf).filter((p): p is string => !!p);

  return {
    rest: [...lines.slice(0, start), ...lines.slice(end)],
    dispatcher: { name, title: titleIdx >= 0 ? head[titleIdx] : undefined, emails, phones },
  };
}

/** Drops quoted history from a reply so we never re-send or re-display it. */
export function stripQuoted(text: string): string {
  const lines = toLines(text);
  const cut = lines.findIndex((l, i) => {
    if (/^\s*On .{5,200}wrote:\s*$/i.test(l)) return true;
    if (/^\s*On .{5,200}$/i.test(l) && /wrote:\s*$/i.test(lines[i + 1] ?? '')) return true;
    if (/^\s*-{2,}\s*Original Message\s*-{2,}/i.test(l)) return true;
    if (/^\s*\*?From:\*?\s.+/i.test(l) && /^\s*\*?(Date|Sent):\*?/i.test(lines[i + 1] ?? '')) return true;
    if (/^\s*\*?From:\*?\s.+/i.test(l) && /^\s*\*?To:\*?/i.test(lines[i + 1] ?? '')) return true;
    return false;
  });
  const kept = (cut >= 0 ? lines.slice(0, cut) : lines).filter((l) => !/^\s*>/.test(l));
  return kept.join('\n').trim();
}

/** Reads "Name\n+1 555 …" style contact blocks. */
export function parseContact(lines: string[]): Contact | undefined {
  const cleaned = lines.map(cleanLine).filter(Boolean);
  if (!cleaned.length) return undefined;
  const phone = cleaned.map(phoneOf).find(Boolean);
  const name = cleaned.filter((l) => !phoneOf(l) || l.replace(PHONE_RE, '').trim().length > 2)
    .map((l) => l.replace(PHONE_RE, '').trim())
    .filter(Boolean)
    .join(', ');
  const email = cleaned.join(' ').match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0];
  return { name: name || undefined, phone, email };
}

const ZONES: Record<string, string> = {
  PDT: 'America/Los_Angeles', PST: 'America/Los_Angeles',
  MDT: 'America/Denver', MST: 'America/Denver',
  CDT: 'America/Chicago', CST: 'America/Chicago',
  EDT: 'America/New_York', EST: 'America/New_York',
  AKDT: 'America/Anchorage', AKST: 'America/Anchorage',
  HST: 'Pacific/Honolulu',
};
export const zoneFromAbbr = (abbr: string) => ZONES[abbr.toUpperCase()];

/** True for boilerplate values that carry no information. */
export const isEmptyValue = (s: string) => /^(none|n\/a|na|-+|null)?\.?$/i.test(s.trim());

/** Splits "Street\nCity, ST 12345" style blocks into name + one-line address. */
export function parseAddressBlock(lines: string[]): { name?: string; address?: string } {
  const cleaned = lines.map(cleanLine).filter((l) => l && !/^(united states( of america)?|usa|us)$/i.test(l));
  if (!cleaned.length) return {};
  const streetIdx = cleaned.findIndex((l) => /^\d+[A-Za-z]?\s+\S+/.test(l));
  if (streetIdx < 0) {
    const [first, ...rest] = cleaned;
    return { name: first, address: rest.join(', ') || undefined };
  }
  const name = cleaned.slice(0, streetIdx).join(' — ') || undefined;
  return { name, address: cleaned.slice(streetIdx).join(', ') };
}

export const AIRLINE_RE = /\b(air ?cargo|airline|tender(ed)?|lock ?-?out|flight|awb|mawb|hawb|airport|SEA-?TAC|\bUA\b|\bAA\b|\bDL\b|\bAS\b|alaska air|united air|delta cargo|american air)/i;
