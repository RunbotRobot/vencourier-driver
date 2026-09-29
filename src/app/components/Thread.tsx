import { useState } from 'preact/hooks';
import { formatLocal } from '../../core/time';
import type { Attachment, Job } from '../../core/types';
import { useApp } from '../ctx';
import { Photos } from './Photos';

/** The whole conversation with dispatch, without opening Gmail. Quoted history and signatures are already stripped. */
export function Thread({ job }: { job: Job }) {
  const { gateway, settings, put } = useApp();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const open = async (a: Attachment) => {
    try {
      const bytes = await gateway.attachmentBytes(job, a);
      window.open(URL.createObjectURL(new Blob([bytes as BlobPart], { type: a.mimeType })), '_blank');
    } catch (e) { setError((e as Error).message); }
  };
  const send = async (e: Event) => {
    e.preventDefault();
    if (!text.trim() && !files.length) return;
    setBusy(true); setError('');
    try { put(await gateway.message(job, text, files)); setText(''); setFiles([]); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  return (
    <section class="card">
      <h2>Messages</h2>
      {job.thread.length === 0 && <p class="muted small">No messages yet.</p>}
      <ul class="thread">
        {job.thread.map((m) => (
          <li class={m.direction} key={m.id}>
            <div class="meta small muted">{m.direction === 'out' ? 'You' : job.dispatcher?.name ?? 'Dispatch'} · {formatLocal(m.at, settings.timezone)}</div>
            <div class="body">{m.text || <i class="muted">(attachment only)</i>}</div>
            {m.attachments.map((a) => (
              <button class="chip" onClick={() => open(a)} disabled={!a.gmailAttachmentId}>{a.mimeType.startsWith('image/') ? '🖼' : '📄'} {a.filename}</button>
            ))}
          </li>
        ))}
      </ul>
      <form onSubmit={send} class="stack">
        <label>Reply to dispatch<textarea rows={2} value={text} onInput={(e) => setText(e.currentTarget.value)} /></label>
        <Photos files={files} onChange={setFiles} />
        {error && <p class="warn">{error}</p>}
        <button class="btn" disabled={busy || (!text.trim() && !files.length)}>{busy ? 'Sending…' : 'Send reply'}</button>
      </form>
      {gateway.simulateReply && (
        <div class="demo small">
          Demo: simulate dispatch —{' '}
          {['Copy', 'Looks great. You are good to go.', 'Order Closed'].map((t) => (
            <button class="link" onClick={async () => put(await gateway.simulateReply!(job, t))}>"{t}"</button>
          ))}
        </div>
      )}
    </section>
  );
}
