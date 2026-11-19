// Shrinks phone photos in the browser before upload. PDFs and non-images pass through untouched.

export interface BitmapLike {
  width: number;
  height: number;
  close?: () => void;
}

export interface CanvasLike {
  draw(img: BitmapLike, width: number, height: number): void;
  toBlob(type: string, quality: number): Promise<Blob>;
}

export interface CompressDeps {
  createImageBitmap: (blob: Blob) => Promise<BitmapLike>;
  makeCanvas: (width: number, height: number) => CanvasLike;
}

/** Size that fits inside maxSide x maxSide, keeping the ratio. Never enlarges. */
export function targetSize(width: number, height: number, maxSide: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxSide) return { width, height };
  const scale = maxSide / long;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

const defaultDeps: CompressDeps = {
  createImageBitmap: (blob) => createImageBitmap(blob),
  makeCanvas: (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return {
      draw(img, w, h) {
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas unavailable');
        ctx.fillStyle = '#fff'; // JPEG has no transparency
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img as unknown as CanvasImageSource, 0, 0, w, h);
      },
      toBlob: (type, quality) =>
        new Promise((resolve, reject) => {
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), type, quality);
        }),
    };
  },
};

/**
 * Returns a JPEG no larger than maxSide on its long edge. Non-images are returned as they are, and so
 * is an image the browser cannot decode (HEIC on most desktops): the server accepts it as it is.
 */
export async function compressImage(
  file: File,
  maxSide = 1600,
  quality = 0.75,
  deps: CompressDeps = defaultDeps,
): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file;
  let bitmap: BitmapLike;
  try {
    bitmap = await deps.createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const { width, height } = targetSize(bitmap.width, bitmap.height, maxSide);
    const canvas = deps.makeCanvas(width, height);
    canvas.draw(bitmap, width, height);
    return await canvas.toBlob('image/jpeg', quality);
  } finally {
    bitmap.close?.();
  }
}
