const MAX_EDGE = 1800;
const QUALITY = 0.82;

/**
 * Phone photos are 3–8 MB each; resizing to ~300 KB keeps every email well under Gmail's 25 MB limit
 * even with a dozen box photos. Non-images (e.g. PDFs) pass through untouched.
 */
export async function prepareAttachment(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file; // undecodable (e.g. HEIC in a browser that can't read it): send as-is
  }
}

export const totalBytes = (files: File[]) => files.reduce((n, f) => n + f.size, 0);
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const megabytes = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
