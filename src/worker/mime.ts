export interface MimeAttachment { filename: string; mimeType: string; base64: string }
export interface MimeMessage {
  from?: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
  attachments?: MimeAttachment[];
}

const wrap = (b64: string) => b64.replace(/.{1,76}/g, '$&\r\n').trimEnd();
const utf8b64 = (s: string) => {
  let bin = '';
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
};
/** RFC 2047 encoded-word for non-ASCII header values. */
export const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${utf8b64(s)}?=`);
const safeName = (s: string) => s.replace(/["\\\r\n]/g, '_');

/**
 * Builds a plain reply: our text plus attachments — deliberately no quoted history and no HTML signature,
 * so photo attachments never compound from message to message.
 */
export function buildMime(m: MimeMessage): string {
  const h = [
    ...(m.from ? [`From: ${m.from}`] : []),
    `To: ${m.to}`,
    `Subject: ${encodeHeader(m.subject)}`,
    'MIME-Version: 1.0',
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`, `References: ${m.references ?? m.inReplyTo}`] : []),
  ];
  const text = ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(utf8b64(m.body))].join('\r\n');
  if (!m.attachments?.length) return [...h, text].join('\r\n');

  const boundary = `vencourier_${crypto.randomUUID().replace(/-/g, '')}`;
  const parts = [`--${boundary}\r\n${text}`];
  for (const a of m.attachments) {
    parts.push(
      `--${boundary}\r\n` +
        [
          `Content-Type: ${a.mimeType}; name="${safeName(a.filename)}"`,
          'Content-Transfer-Encoding: base64',
          `Content-Disposition: attachment; filename="${safeName(a.filename)}"`,
          '',
          wrap(a.base64),
        ].join('\r\n'),
    );
  }
  return [...h, `Content-Type: multipart/mixed; boundary="${boundary}"`, '', parts.join('\r\n'), `--${boundary}--`, ''].join('\r\n');
}

export function toBase64Url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
