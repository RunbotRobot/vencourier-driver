import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { parseJobEmail } from '../src/core/parser';
import { composeBody, statusLine } from '../src/core/emails';
import { applyDispatchReply, applyStep, canApply, classifyDispatchReply, needsPrintConfirmation, shouldSuggestCallingDispatch } from '../src/core/workflow';
import { hhmm, hhmmToIso, normalizeHhmm } from '../src/core/time';
import { mapLink, computeEtas } from '../src/core/routing';
import { resolveStop, SEED_RULES } from '../src/core/locations';
import { dwellMinutes, expectedDwell, recordDwell } from '../src/core/stats';
import { buildPrintPdf, parsePageRange, planPaperwork } from '../src/core/paperwork';
import { AIRSPACE_EMAIL, FREEFORM_EMAIL } from './fixtures';

const TZ = 'America/Los_Angeles';
const at = (hm: string) => `2026-09-25T${hm}:00.000Z`; // 18:05Z = 11:05 PDT

describe('time', () => {
  it('formats military time without a colon in the driver zone', () => {
    expect(hhmm('2026-09-26T01:05:00Z', TZ)).toBe('1805');
    expect(hhmm('2026-09-25T07:07:00Z', TZ)).toBe('0007');
  });
  it('normalises driver input', () => {
    expect(normalizeHhmm('18:05')).toBe('1805');
    expect(normalizeHhmm('6:05 pm')).toBe('1805');
    expect(normalizeHhmm('2560')).toBeNull();
  });
  it('turns an entered hhmm into today\'s instant', () => {
    expect(hhmmToIso('1745', new Date('2026-09-26T01:00:00Z'), TZ)).toBe('2026-09-26T00:45:00.000Z');
  });
});

describe('email text', async () => {
  const ground = await parseJobEmail(AIRSPACE_EMAIL);
  const air = await parseJobEmail(FREEFORM_EMAIL);
  const t = '2026-09-26T01:11:00Z'; // 1811 PDT

  it('follows the spec wording', () => {
    expect(statusLine(ground, { step: 'accept', leaveNow: false, at: t })).toBe('Coverage confirmed.');
    expect(statusLine(ground, { step: 'accept', leaveNow: true, eta: '1745', at: t })).toBe('Coverage confirmed. En route to pickup location, ETA 1745.');
    expect(statusLine(ground, { step: 'enRoute', eta: '1745', at: t })).toBe('En route to pickup location, ETA 1745.');
    expect(statusLine(ground, { step: 'onsitePickup', at: t })).toBe('Onsite at pickup location 1811.');
    expect(statusLine(ground, { step: 'onsiteDelivery', at: t })).toBe('Onsite at delivery location 1811.');
  });
  it('uses recovered/tendered for air cargo only', () => {
    expect(statusLine(ground, { step: 'pickedUp', at: t })).toBe('Cargo picked up and onboard 1811.');
    expect(statusLine(ground, { step: 'delivered', at: t })).toBe('Cargo delivered 1811.');
    const flightPickup = { ...air, pickup: { ...air.pickup, place: { ...air.pickup.place, kind: 'airline' as const } } };
    expect(statusLine(flightPickup, { step: 'pickedUp', at: t })).toBe('Cargo recovered and onboard 1811.');
    expect(statusLine(air, { step: 'delivered', at: t })).toBe('Cargo tendered 1811.');
  });
  it('appends notes below the status line', () => {
    expect(composeBody(ground, { step: 'onsitePickup', at: t, notes: 'Dock 29.' })).toBe('Onsite at pickup location 1811.\n\nDock 29.');
  });
});

describe('workflow', async () => {
  const offered = await parseJobEmail(AIRSPACE_EMAIL);

  it('walks the full happy path', () => {
    let j = applyStep(offered, { step: 'accept', leaveNow: false, at: at('18:00') });
    expect([j.status, j.step]).toEqual(['active', 'confirmed']);
    j = applyStep(j, { step: 'enRoute', eta: '1140', at: at('18:10') });
    j = applyStep(j, { step: 'onsitePickup', at: at('18:30') });
    j = applyStep(j, { step: 'pickedUp', at: at('18:47') });
    expect(dwellMinutes(j)).toBe(17);
    j = applyStep(j, { step: 'onsiteDelivery', at: at('19:20') });
    j = applyStep(j, { step: 'delivered', at: at('19:30') });
    j = applyDispatchReply(j, 'clearance', at('19:35'));
    expect([j.status, j.step]).toEqual(['completed', 'complete']);
  });

  it('accepting and leaving now skips the separate en-route step', () => {
    const j = applyStep(offered, { step: 'accept', leaveNow: true, eta: '1140', at: at('18:00') });
    expect(j.step).toBe('enRoute');
    expect(j.etaToPickup).toBe('1140');
  });
  it('declines and rejects illegal transitions', () => {
    expect(applyStep(offered, { step: 'decline' }).status).toBe('declined');
    expect(canApply(offered, 'delivered')).toBe(false);
    expect(() => applyStep(offered, { step: 'pickedUp' })).toThrow();
  });
  it('nudges to call dispatch after five minutes, without blocking', () => {
    let j = applyStep(applyStep(applyStep(offered, { step: 'accept', at: at('18:00') }), { step: 'onsitePickup', at: at('18:10') }), { step: 'pickedUp', at: at('18:20') });
    const t0 = new Date(at('18:20')).getTime();
    expect(shouldSuggestCallingDispatch(j, t0 + 4 * 60_000)).toBe(false);
    expect(shouldSuggestCallingDispatch(j, t0 + 5 * 60_000)).toBe(true);
    expect(canApply(j, 'onsiteDelivery')).toBe(true); // still allowed
    j = applyDispatchReply(j, 'clearance', at('18:22'));
    expect(shouldSuggestCallingDispatch(j, t0 + 10 * 60_000)).toBe(false);
  });
  it('classifies dispatch replies seen in real threads', () => {
    expect(classifyDispatchReply('Looks great. You are good to go.')).toBe('clearance');
    expect(classifyDispatchReply("Copy looks great. You re good togo")).toBe('clearance');
    expect(classifyDispatchReply('Proceed')).toBe('clearance');
    expect(classifyDispatchReply('Order Closed')).toBe('closed');
    expect(classifyDispatchReply('Copy')).toBe('ack');
    expect(classifyDispatchReply('Find what you needed?')).toBe('other');
  });
  it('asks before onsiting with unprinted paperwork only when there is paperwork', async () => {
    expect(needsPrintConfirmation(offered)).toBe(false);
    const withPdf = { ...offered, attachments: [{ filename: 'BOL.pdf', mimeType: 'application/pdf' }] };
    expect(needsPrintConfirmation(withPdf)).toBe(true);
    expect(needsPrintConfirmation({ ...withPdf, paperworkPrintedAt: at('18:00') })).toBe(false);
  });
});

describe('routing & locations', () => {
  const boeing = { name: 'Boeing Everett Factory', address: '3003 W Casino Rd, Everett, WA', kind: 'ground' as const };
  it('sends pre-1700 Boeing Everett deliveries to the E70 gate', () => {
    const early = resolveStop(boeing, new Date('2026-09-28T20:00:00Z'), SEED_RULES, TZ); // 1300
    expect(early.ruleId).toBe('boeing-everett-e70');
    expect(early.query).toContain('E70');
    const late = resolveStop(boeing, new Date('2026-09-29T00:30:00Z'), SEED_RULES, TZ); // 1730
    expect(late.ruleId).toBeUndefined();
    expect(late.query).toBe('3003 W Casino Rd, Everett, WA');
  });
  it('builds full-route links', () => {
    const stops = [{ query: 'A St', label: 'A' }, { query: 'B St', label: 'B' }];
    expect(mapLink('google', stops)).toBe('https://www.google.com/maps/dir/?api=1&destination=B%20St&travelmode=driving&waypoints=A%20St');
    expect(mapLink('apple', stops)).toContain('daddr=A%20St+to:B%20St');
    expect(mapLink('waze', stops)).toContain('q=A%20St');
  });
  it('adds pickup dwell to the delivery ETA', () => {
    const e = computeEtas({ toPickup: { meters: 1, seconds: 1200 }, pickupToDelivery: { meters: 1, seconds: 1800 } }, new Date('2026-09-25T18:00:00Z'), 15);
    expect(e.arrivePickup.toISOString()).toBe('2026-09-25T18:20:00.000Z');
    expect(e.arriveDelivery.toISOString()).toBe('2026-09-25T19:05:00.000Z');
  });
});

describe('pickup dwell learning', async () => {
  const job = await parseJobEmail(AIRSPACE_EMAIL);
  it('defaults to 15 min, then uses the median of real visits', () => {
    expect(expectedDwell({}, job.pickup.place)).toEqual({ minutes: 15, samples: 0 });
    let stats = {};
    for (const [a, b] of [['18:00', '18:10'], ['18:00', '18:30'], ['18:00', '18:20']]) {
      const j = { ...job, timeline: { onsitePickup: at(a!), pickedUp: at(b!) } };
      stats = recordDwell(stats, j);
    }
    expect(expectedDwell(stats, job.pickup.place)).toEqual({ minutes: 20, samples: 3 });
  });
});

describe('paperwork', () => {
  it('plans the last page of the alert once per box when dispatch says so', () => {
    const text = 'PLEASE ENSURE THE LAST PAGE OF THE ALERT IS PRINTED AND AFFIX TO ALL BOXES.';
    const plan = planPaperwork([{ name: '9273765.pdf', pageCount: 5 }, { name: '9273765 awb editor.pdf', pageCount: 2 }, { name: 'BOL.pdf', pageCount: 1 }], { text, pieces: 3 });
    expect(plan[0]).toMatchObject({ pages: [5], copies: 3 });
    expect(plan[1]).toMatchObject({ pages: [], copies: 0 });
    expect(plan[2]).toMatchObject({ pages: [1], copies: 1 });
  });
  it('builds a PDF with only the selected pages', async () => {
    const mk = async (n: number) => { const d = await PDFDocument.create(); for (let i = 0; i < n; i++) d.addPage(); return d.save(); };
    const out = await buildPrintPdf([
      { name: 'a.pdf', pages: [3], copies: 2, reason: '', bytes: await mk(4) },
      { name: 'b.pdf', pages: [1, 2], copies: 1, reason: '', bytes: await mk(2) },
    ]);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(4);
    expect(parsePageRange('1-3, 5, 9', 5)).toEqual([1, 2, 3, 5]);
  });
});
