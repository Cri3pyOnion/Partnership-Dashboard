import { describe, expect, it } from 'vitest';
import { compressImage, targetSize, type CompressDeps } from '../../src/admin/lib/compress-image';

describe('targetSize', () => {
  it('shrinks a landscape image so the long side is maxSide', () => {
    expect(targetSize(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
  });
  it('leaves a small image unchanged', () => {
    expect(targetSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
  it('shrinks a portrait image by its height', () => {
    expect(targetSize(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });
});

function fakeDeps(w: number, h: number) {
  const calls: { canvas?: [number, number]; drawn?: [number, number]; type?: string; quality?: number; closed: boolean } = { closed: false };
  const deps: CompressDeps = {
    createImageBitmap: async () => ({ width: w, height: h, close: () => { calls.closed = true; } }),
    makeCanvas: (cw, ch) => {
      calls.canvas = [cw, ch];
      return {
        draw: (_img, dw, dh) => { calls.drawn = [dw, dh]; },
        toBlob: async (type, quality) => {
          calls.type = type;
          calls.quality = quality;
          return new Blob(['jpeg-bytes'], { type });
        },
      };
    },
  };
  return { deps, calls };
}

describe('compressImage', () => {
  it('draws a 4000x3000 photo at 1600 wide and returns a JPEG blob', async () => {
    const { deps, calls } = fakeDeps(4000, 3000);
    const out = await compressImage(new File(['x'], 'shop.png', { type: 'image/png' }), 1600, 0.75, deps);
    expect(calls.canvas).toEqual([1600, 1200]);
    expect(calls.drawn).toEqual([1600, 1200]);
    expect(calls.type).toBe('image/jpeg');
    expect(calls.quality).toBe(0.75);
    expect(calls.closed).toBe(true);
    expect(out.type).toBe('image/jpeg');
  });

  it('returns a PDF unchanged', async () => {
    const { deps, calls } = fakeDeps(10, 10);
    const pdf = new File(['%PDF'], 'ssm.pdf', { type: 'application/pdf' });
    expect(await compressImage(pdf, 1600, 0.75, deps)).toBe(pdf);
    expect(calls.canvas).toBeUndefined();
  });

  it('returns other non-images unchanged', async () => {
    const { deps } = fakeDeps(10, 10);
    const txt = new File(['hi'], 'a.txt', { type: 'text/plain' });
    expect(await compressImage(txt, 1600, 0.75, deps)).toBe(txt);
  });

  it('returns the original when the browser cannot decode the image (e.g. HEIC)', async () => {
    const deps: CompressDeps = {
      createImageBitmap: async () => { throw new Error('cannot decode'); },
      makeCanvas: () => { throw new Error('unused'); },
    };
    const heic = new File(['x'], 'p.heic', { type: 'image/heic' });
    expect(await compressImage(heic, 1600, 0.75, deps)).toBe(heic);
  });
});
