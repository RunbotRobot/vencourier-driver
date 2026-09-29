import type { Job } from '../types';
import { looksLikeAirspace, parseAirspace } from './airspace';
import { parseFreeform } from './freeform';
import { parseWithLlm, type LlmConfig, type LlmParse } from './llm';

export interface InboundEmail {
  subject: string;
  text: string;
  from: string;
  receivedAt: string;
  gmailThreadId?: string;
  gmailMessageId?: string;
  rfcMessageId?: string;
  attachments?: Job['attachments'];
}

type Parsed = ReturnType<typeof parseFreeform> | ReturnType<typeof parseAirspace>;

/** How much of the essentials we found: pickup address, delivery address, some timing. */
export function completeness(p: Pick<Parsed, 'pickup' | 'delivery'>): number {
  const checks = [p.pickup.place.address, p.delivery.place.address, p.pickup.time ?? p.pickup.timeText, p.delivery.time ?? p.delivery.timeText];
  return checks.filter(Boolean).length / checks.length;
}

function mergeLlm(p: Parsed, l: LlmParse): Parsed {
  const leg = (base: Parsed['pickup'], x?: NonNullable<LlmParse['pickup']>): Parsed['pickup'] => ({
    place: {
      ...base.place,
      name: base.place.name ?? x?.place?.name,
      address: base.place.address ?? x?.place?.address,
      contact: base.place.contact ?? (x?.place?.contactName || x?.place?.contactPhone
        ? { name: x.place.contactName, phone: x.place.contactPhone } : undefined),
      kind: x?.place?.isAirCargo ? 'airline' : base.place.kind,
    },
    time: base.time ?? x?.timeIso,
    timeText: base.timeText ?? x?.timeText,
    notes: base.notes ?? x?.notes,
  });
  return {
    ...p,
    orderNumber: p.orderNumber ?? l.orderNumber,
    references: p.references.length ? p.references : l.references ?? [],
    pickup: leg(p.pickup, l.pickup),
    delivery: leg(p.delivery, l.delivery),
    cargo: { ...l.cargo, ...p.cargo },
    // The LLM re-sorts the leftover text, so its notes replace the heuristic leftovers.
    notes: l.notes ?? p.notes,
  };
}

export async function parseJobEmail(email: InboundEmail, opts: { llm?: LlmConfig; minCompleteness?: number } = {}): Promise<Job> {
  let parsed: Parsed = looksLikeAirspace(email.text, email.subject) ? parseAirspace(email) : parseFreeform(email);
  let parser: Job['source']['parser'] = parsed.parser;

  if (opts.llm && completeness(parsed) < (opts.minCompleteness ?? 0.75)) {
    try {
      parsed = mergeLlm(parsed, await parseWithLlm(opts.llm, email));
      parser = 'llm';
    } catch {
      // keep the heuristic result; the raw email is always viewable
    }
  }

  const { parser: _p, ...fields } = parsed;
  return {
    ...fields,
    id: email.gmailThreadId ?? crypto.randomUUID(),
    attachments: email.attachments ?? [],
    status: 'offered',
    step: 'offered',
    timeline: {},
    thread: [],
    source: {
      gmailThreadId: email.gmailThreadId,
      gmailMessageId: email.gmailMessageId,
      rfcMessageId: email.rfcMessageId,
      subject: email.subject,
      from: email.from,
      receivedAt: email.receivedAt,
      rawText: email.text,
      parser,
    },
  };
}
