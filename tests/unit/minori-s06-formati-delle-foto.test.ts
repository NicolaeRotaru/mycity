import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ALLOWED_IMAGE_TYPES } from '@/lib/products/uploadImages';
import { TIPI_IMMAGINE, regolaDelSecchio } from '@/lib/storage/regole-secchi';
import { formatiLeggibili } from '@/lib/storage/carica-immagine';

/**
 * S06 — Formati e tetto delle foto.
 * 1529: i formati delle foto prodotto nascono dalla lista unica (meno HEIC, che i browser non mostrano).
 * 1593: la soglia di ricompressione è il tetto vero del magazzino, non una terza copia da 5 MB.
 * 1605: il rifiuto elenca i formati che la porta accetta davvero.
 */
describe('1529 — una lista sola', () => {
  it('le foto prodotto sono la lista del magazzino senza HEIC/HEIF', () => {
    expect(ALLOWED_IMAGE_TYPES).toEqual(TIPI_IMMAGINE.filter((t) => t !== 'image/heic' && t !== 'image/heif'));
    expect(ALLOWED_IMAGE_TYPES).toContain('image/avif');
  });
});

describe('1593 — il tetto vero', () => {
  it('uploadImages non tiene più un suo 5 MiB', () => {
    const s = readFileSync('lib/products/uploadImages.ts', 'utf8');
    expect(s).not.toMatch(/5 \* 1024 \* 1024/);
    expect(s).toContain("regolaDelSecchio('products').maxByte");
    expect(regolaDelSecchio('products').maxByte).toBe(10 * 1024 * 1024);
  });
});

describe('1605 — la frase del rifiuto', () => {
  it('nomina tutti i formati ammessi', () => {
    expect(formatiLeggibili(regolaDelSecchio('products').tipiAmmessi)).toBe('JPG, PNG, WEBP, GIF, AVIF, HEIC o HEIF');
  });
});
