import { PDFDocument } from 'pdf-lib';
import { useEffect, useState } from 'preact/hooks';
import { buildPrintPdf, parsePageRange, planPaperwork } from '../../core/paperwork';
import type { Attachment, Job } from '../../core/types';
import { printablePdfs } from '../../core/workflow';
import { useApp } from '../ctx';

interface Row { att: Attachment; bytes: Uint8Array; pageCount: number; include: boolean; pages: string; copies: number; reason: string }

/** Works out which pages need printing, lets you adjust, and produces one PDF of only those pages. */
export function PaperworkPanel({ job, onClose, onPrinted }: { job: Job; onClose(): void; onPrinted(): void }) {
  const { gateway, put } = useApp();
  const [rows, setRows] = useState<Row[]>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const atts = printablePdfs(job);
        const loaded = await Promise.all(atts.map(async (att) => {
          const bytes = await gateway.attachmentBytes(job, att);
          const pageCount = (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
          return { att, bytes, pageCount };
        }));
        const hints = { text: [job.source.rawText, ...job.thread.map((m) => m.text)].join('\n'), pieces: job.cargo.pieces };
        const plan = planPaperwork(loaded.map((l) => ({ name: l.att.filename, pageCount: l.pageCount })), hints);
        setRows(loaded.map((l, i) => {
          const p = plan[i]!;
          return { ...l, include: p.pages.length > 0, pages: p.pages.join(', '), copies: p.copies || 1, reason: p.reason };
        }));
      } catch (e) { setError((e as Error).message); }
    })();
  }, [job.id]);

  const patch = (i: number, r: Partial<Row>) => setRows((rows ?? []).map((x, j) => (j === i ? { ...x, ...r } : x)));

  const generate = async () => {
    setBusy(true); setError('');
    try {
      const items = (rows ?? []).filter((r) => r.include).map((r) => ({
        name: r.att.filename, bytes: r.bytes, copies: r.copies, reason: r.reason, pages: parsePageRange(r.pages, r.pageCount),
      }));
      const out = await buildPrintPdf(items);
      setUrl(URL.createObjectURL(new Blob([out as BlobPart], { type: 'application/pdf' })));
      put(await gateway.markPrinted(job));
      onPrinted();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div class="modal" role="dialog" aria-label="Print paperwork">
      <div class="sheet">
        <h2>Print paperwork</h2>
        {!rows && !error && <p class="muted">Reading paperwork…</p>}
        {rows?.length === 0 && <p class="muted">No PDFs found in this job's emails.</p>}
        {rows?.map((r, i) => (
          <div class="pdfrow" key={r.att.filename}>
            <label class="check"><input type="checkbox" checked={r.include} onChange={(e) => patch(i, { include: e.currentTarget.checked })} /> <b>{r.att.filename}</b> <span class="muted small">({r.pageCount} pp)</span></label>
            <div class="muted small">{r.reason}</div>
            {r.include && (
              <div class="row">
                <label class="small">Pages <input value={r.pages} onInput={(e) => patch(i, { pages: e.currentTarget.value })} /></label>
                <label class="small">Copies <input type="number" min={1} max={99} value={r.copies} onInput={(e) => patch(i, { copies: Number(e.currentTarget.value) || 1 })} /></label>
              </div>
            )}
          </div>
        ))}
        {error && <p class="warn">{error}</p>}
        {url && <a class="btn primary" href={url} target="_blank" rel="noopener">Open PDF to print</a>}
        <div class="row">
          <button class="btn" onClick={onClose}>{url ? 'Done' : 'Close'}</button>
          {!url && rows && rows.some((r) => r.include) && <button class="btn primary" disabled={busy} onClick={generate}>{busy ? 'Building…' : 'Generate PDF'}</button>}
        </div>
      </div>
    </div>
  );
}
