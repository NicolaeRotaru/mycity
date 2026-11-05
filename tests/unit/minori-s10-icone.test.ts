import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/**
 * S10 (5/11/2026, scheda 830) — le icone PNG (Home del telefono, iPhone,
 * maskable) sono rigenerate dall'SVG del marchio, coi tracciati di Fraunces:
 * non più il «My» in un carattere di sistema. Prova leggera: misure, canale
 * alfa giusto e che non siano più i file di prima.
 */
const VECCHIE: Record<string, string> = {
  'public/icon-512.png': '22348',
  'public/icon-192.png': '6041',
  'public/apple-touch-icon.png': '4689',
  'public/icon-maskable-512.png': '17325',
};
function testaPng(f: string) {
  const b = readFileSync(f);
  return { lato: b.readUInt32BE(16), alto: b.readUInt32BE(20), tipoColore: b[25], peso: String(b.length), hash: createHash('sha1').update(b).digest('hex') };
}

describe('le icone PNG vengono dal marchio (830)', () => {
  it('misure e trasparenza giuste', () => {
    expect(testaPng('public/icon-512.png')).toMatchObject({ lato: 512, alto: 512, tipoColore: 6 });
    expect(testaPng('public/icon-192.png')).toMatchObject({ lato: 192, alto: 192, tipoColore: 6 });
    // iPhone e maskable: piene, senza trasparenza (gli angoli li taglia il sistema).
    expect(testaPng('public/apple-touch-icon.png')).toMatchObject({ lato: 180, alto: 180, tipoColore: 2 });
    expect(testaPng('public/icon-maskable-512.png')).toMatchObject({ lato: 512, alto: 512, tipoColore: 2 });
  });
  it('non sono più i file col carattere di sistema', () => {
    for (const [f, peso] of Object.entries(VECCHIE)) expect(testaPng(f).peso, f).not.toBe(peso);
  });
});
