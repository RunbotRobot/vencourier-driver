export type JobStatus = 'offered' | 'declined' | 'active' | 'completed';

/** Where the job is in the driver's walk-through. Order matters (see workflow.ts). */
export type JobStep =
  | 'offered'
  | 'confirmed' // coverage confirmed, not yet moving
  | 'enRoute' // en route to pickup
  | 'onsitePickup'
  | 'pickedUp' // cargo onboard; waiting on dispatch clearance
  | 'onsiteDelivery'
  | 'delivered' // delivered/tendered; waiting on dispatch sign-off
  | 'complete'
  | 'declined';

export type LocationKind = 'ground' | 'airline';

export interface Contact {
  name?: string;
  phone?: string;
  email?: string;
}

export interface Place {
  /** Business / facility name, e.g. "Medline C75 Warehouse". */
  name?: string;
  /** Street address, one line. */
  address?: string;
  contact?: Contact;
  /** Air cargo facilities use "recovered"/"tendered" wording. */
  kind: LocationKind;
}

export interface Leg {
  place: Place;
  /** ISO timestamp of scheduled pickup / deliver-by. */
  time?: string;
  /** Time exactly as written in the email, kept if it could not be parsed. */
  timeText?: string;
  notes?: string;
}

export interface Reference {
  label: string;
  value: string;
}

export interface Cargo {
  pieces?: number;
  weight?: string;
  dimensions?: string;
  commodity?: string;
  vehicleType?: string;
  dangerousGoods?: string;
  /** Per-piece IDs (Airspace "IDs:" line). */
  pieceIds?: string[];
}

export interface Attachment {
  filename: string;
  mimeType: string;
  /** Gmail attachment id (server) — bytes are fetched on demand. */
  gmailAttachmentId?: string;
  messageId?: string;
}

export interface Dispatcher {
  name?: string;
  title?: string;
  emails: string[];
  phones: string[];
}

export interface Job {
  id: string;
  /** Short headline, e.g. "Medline C75 → CHI-St Clare Hospital". */
  name: string;
  /** Customer-facing order number, e.g. 4102894. */
  orderNumber?: string;
  /** Internal / tracking / delivery ids that do not fit elsewhere. */
  references: Reference[];
  pickup: Leg;
  delivery: Leg;
  cargo: Cargo;
  dispatcher?: Dispatcher;
  portalUrl?: string;
  /** Everything not captured by a field above. */
  notes: string;
  attachments: Attachment[];
  source: {
    gmailThreadId?: string;
    /** Message the driver replies to (latest in thread). */
    gmailMessageId?: string;
    rfcMessageId?: string;
    subject: string;
    from: string;
    receivedAt: string;
    /** Original plain text, viewable in the UI. */
    rawText: string;
    parser: 'airspace' | 'freeform' | 'llm';
  };
  status: JobStatus;
  step: JobStep;
  /** ISO timestamps for each step reached. */
  timeline: Partial<Record<JobStep, string>>;
  /** ISO time cargo was picked up — starts the 5-minute dispatch-check timer. */
  clearanceRequestedAt?: string;
  /** Dispatch said "good to go" after pickup. */
  dispatchClearedAt?: string;
  paperworkPrintedAt?: string;
  etaToPickup?: string;
  /** Conversation with dispatch, quoted text and signatures stripped. */
  thread: ThreadMessage[];
}

export interface ThreadMessage {
  id: string;
  direction: 'in' | 'out';
  from: string;
  at: string;
  text: string;
  attachments: Attachment[];
}

export interface StepRequest {
  step: 'accept' | 'decline' | 'enRoute' | 'onsitePickup' | 'pickedUp' | 'onsiteDelivery' | 'delivered' | 'complete';
  /** When it happened (ISO); defaults to now. Military time in the email comes from this. */
  at?: string;
  /** Accept: leave now (with ETA) vs leave later. */
  leaveNow?: boolean;
  eta?: string;
  etaToDelivery?: string;
  notes?: string;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  inReplyToMessageId?: string;
  attachments: { filename: string; mimeType: string; base64: string }[];
}
