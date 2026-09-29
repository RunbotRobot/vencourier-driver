import { describe, expect, it } from 'vitest';
import { parseJobEmail } from '../src/core/parser';
import { stripQuoted } from '../src/core/parser/text';
import { AIRSPACE_EMAIL, FREEFORM_EMAIL } from '../src/core/fixtures';

describe('Airspace parser', async () => {
  const job = await parseJobEmail(AIRSPACE_EMAIL);

  it('extracts ids and name', () => {
    expect(job.source.parser).toBe('airspace');
    expect(job.orderNumber).toBe('4102894');
    expect(job.name).toBe('Medline C75 to CHI-ST CLARE HOSPITAL');
    expect(job.references).toEqual([
      { label: 'Tracking ID', value: 'ATXCN7GRHH' },
      { label: 'Delivery #', value: '8323700250' },
    ]);
  });

  it('extracts legs with correct zoned times', () => {
    expect(job.pickup.time).toBe('2026-09-25T18:35:00.000Z'); // 11:35 PDT
    expect(job.delivery.time).toBe('2026-09-25T19:55:00.000Z'); // 12:55 PDT
    expect(job.pickup.place).toMatchObject({
      name: 'Medline C75 Warehouse',
      address: '3770 Hogum Bay Road Northeast, Lacey, WA 98516',
      contact: { name: 'Shipping', phone: '+1 360-555-0102' },
    });
    expect(job.delivery.place.contact).toMatchObject({ name: 'DARLENE DAVIS', phone: '+1 253-555-0103' });
    expect(job.pickup.notes).toMatch(/Dock Door 29/);
    expect(job.delivery.notes).toBeUndefined(); // "None"
  });

  it('extracts cargo', () => {
    expect(job.cargo).toMatchObject({
      pieces: 6, weight: '54.00 LBS', vehicleType: 'CAR', dangerousGoods: 'NO', commodity: 'Medical Devices',
      dimensions: '6 of 13.0 x 10.0 x 5.0 IN @ 9.0 LBS each',
    });
    expect(job.cargo.pieceIds).toHaveLength(6);
  });

  it('shows each fact once: notes hold only what has no field', () => {
    expect(job.notes).toBe('Airspace must give you verbal or written approval to proceed.');
    expect(job.dispatcher?.name).toBe('Scott Graue');
    expect(job.portalUrl).toContain('partner_portal');
    expect(job.notes).not.toMatch(/Dock Door|Medline|8323700250/);
  });
});

describe('Freeform parser', async () => {
  const job = await parseJobEmail(FREEFORM_EMAIL);

  it('pulls what it can and keeps the rest as notes', () => {
    expect(job.source.parser).toBe('freeform');
    expect(job.orderNumber).toBe('SD0024780');
    expect(job.name).toBe('VasAero-Kent to UA');
    expect(job.references).toContainEqual({ label: 'Reference', value: '9273765' });
    expect(job.pickup.place.address).toBe('18202 80TH AVE S, KENT WA, 98032');
    expect(job.pickup.place.name).toBe('VAS AERO SERVICES,LLC. — ATTN: SHIPPING DEPT. (NORTH DOOR 6)');
    expect(job.cargo).toMatchObject({ dimensions: '19X9X7 in.', weight: '2 lbs.' });
    expect(job.delivery.place.kind).toBe('airline');
    expect(job.notes).toContain('lock out before 1215');
    expect(job.notes).not.toContain('Dims');
    expect(job.dispatcher?.name).toBe('Darren L. Mitchell Jr.');
  });
});

describe('stripQuoted', () => {
  it('removes Gmail and Outlook quoted history', () => {
    expect(stripQuoted('Copy\n\nOn Fri, Sep 25, 2026, 18:58 Moving Forward Dispatch\n<d@x.vip> wrote:\n> Proceed')).toBe('Copy');
    expect(stripQuoted('Looks great.\nFrom: James <a@b.c>\nDate: Friday\nTo: x')).toBe('Looks great.');
    expect(stripQuoted('Hi\n> quoted')).toBe('Hi');
  });
});
