import type { InboundEmail } from '../src/core/parser';

/** Modelled on real Airspace job alerts; names, codes and phone numbers are fictional. */
export const AIRSPACE_EMAIL: InboundEmail = {
  subject: '4102894 Medline C75 to CHI-ST CLARE HOSPITAL',
  from: 'dispatch@movingforward.vip',
  receivedAt: '2026-09-25T17:17:30Z',
  gmailThreadId: 'thread-airspace-1',
  text: `Tracking ID: ATXCN7GRHH, Order #: 4102894 - Pickup Dispatch
[logo]
Order #4102894
Dear Moving Forward, LLC S+N,
Please see details below for an order we seek coverage on. Reply to this email to confirm coverage and provide driver ETA and transit time before dispatching. Airspace must give you verbal or written approval to proceed.
PICKUP AT:
Sep 25, 2026, 11:35 PDT
PICKUP INSTRUCTIONS:
Ready for pickup @ 1130am. Proceed to 3rd gate, you should be able to see dock doors on your right, use gate code if the gate is closed (0000#). Pickup at Dock Door 29, walk in to the man door, press buzzer to get attention of staff. Reference delivery number on pickup. After 5pm please contact Pat (360) 555-0101
DELIVER BY:
Sep 25, 2026, 12:55 PDT
DELIVERY INSTRUCTIONS:
None
Kind regards,
Order details
Upon confirmation, all communication will go through the Airspace Partner Portal.<http://dashboard.example.com/partner_portal.ABC123>
ORDER REFERENCES:
Delivery #: 8323700250
PICKUP ADDRESS:
Medline C75 Warehouse
3770 Hogum Bay Road Northeast
Lacey, WA 98516
United States of America
PICKUP CONTACT:
Shipping
+1 360-555-0102<tel:+13605550102>
DELIVERY ADDRESS:
CHI-ST CLARE HOSPITAL
11315 Bridgeport Way Southwest
Lakewood, WA 98499
United States of America
DELIVERY CONTACT:
DARLENE DAVIS
+1 253-555-0103<tel:+12535550103>
VEHICLE TYPE: CAR
DANGEROUS GOODS: NO
TOTAL PIECES: 6
TOTAL WEIGHT: 54.00 LBS
6 of 13.0 x 10.0 x 5.0 IN @ 9.0 LBS each
Commodity: Medical Devices
IDs: ATMK9TNWAY, ATRC773YE3, ATYJ4364X3, ATTHP7MH2H, ATRMK93PK7, ATMNWXC39N

Scott Graue
MF Dispatcher
Email: Dispatch<mailto:dispatch@movingforward.vip> OR Work<mailto:scott@example.com>
Dispatch #: +1(253)555-0104<tel:%20+12535550104>
[Unknown.jpeg]`,
};

export const FREEFORM_EMAIL: InboundEmail = {
  subject: 'SD0024780 / 9273765  (VasAero-Kent to UA)',
  from: 'dispatch@movingforward.vip',
  receivedAt: '2026-09-26T00:25:23Z',
  gmailThreadId: 'thread-freeform-1',
  text: `We are having an internal system issue to dispatch this job to you .

Please confirm if you can arrange pick today and tender to UA SEA tomorrow lock out before 1215

Dims: 19X9X7 in.
Weight: 2 lbs.
Pick up ref# (JOB# SD0024780)

PICK UP ADDRESS:
VAS AERO SERVICES,LLC.
ATTN: SHIPPING DEPT. (NORTH DOOR 6)
18202 80TH AVE S
KENT WA, 98032

[Image]

Darren L. Mitchell Jr.
Darren Mitchell
Administrative Assistant/Dispatcher
Email: Dispatch<mailto:dispatch@movingforward.vip> OR Work<mailto:darren@example.com>
Dispatch #: +1(253)555-0104<tel:%20+12535550104>
Personal #: +1(206)555-0105<tel:%20+12065550105>`,
};
