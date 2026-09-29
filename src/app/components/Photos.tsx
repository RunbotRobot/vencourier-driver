import { useRef, useState } from 'preact/hooks';
import { MAX_TOTAL_BYTES, megabytes, prepareAttachment, totalBytes } from '../image';

/** Camera + file picker. Images are shrunk on add so emails stay small. */
export function Photos({ files, onChange, hint }: { files: File[]; onChange(f: File[]): void; hint?: string }) {
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    const prepared = await Promise.all([...list].map(prepareAttachment));
    setBusy(false);
    onChange([...files, ...prepared]);
  };
  const size = totalBytes(files);

  return (
    <div class="photos">
      <div class="row">
        <button type="button" class="btn" onClick={() => camera.current?.click()}>📷 Take photo</button>
        <button type="button" class="btn" onClick={() => picker.current?.click()}>📁 Choose files</button>
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { add(e.currentTarget.files); e.currentTarget.value = ''; }} />
      <input ref={picker} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { add(e.currentTarget.files); e.currentTarget.value = ''; }} />
      {hint && !files.length && <p class="muted small">{hint}</p>}
      {busy && <p class="muted small">Preparing photo…</p>}
      {files.length > 0 && (
        <ul class="thumbs">
          {files.map((f, i) => (
            <li key={i}>
              {f.type.startsWith('image/') ? <img src={URL.createObjectURL(f)} alt="" /> : <span class="doc">PDF</span>}
              <span class="small">{f.name.slice(0, 18)} · {megabytes(f.size)}</span>
              <button type="button" class="x" aria-label="Remove" onClick={() => onChange(files.filter((_, j) => j !== i))}>×</button>
            </li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <p class={size > MAX_TOTAL_BYTES ? 'warn small' : 'muted small'}>
          {files.length} attachment{files.length > 1 ? 's' : ''} · {megabytes(size)}{size > MAX_TOTAL_BYTES ? ' — too large, remove some' : ''}
        </p>
      )}
    </div>
  );
}
