import { describe, it, expect } from 'vitest';
import { tipoDaiPrimiByte, laFirmaCombacia, ESTENSIONE_PER_TIPO } from '@/lib/upload/firma-del-file';
import { segretiCombaciano, gettoneBearer } from '@/lib/api/segreti';

/**
 * 22/8/2026 — DUE CONTROLLI CHE SI FIDAVANO DI CHI CARICA.
 *
 * Il caricamento dei documenti d'identità guardava due valori scritti dal
 * chiamante: il tipo dichiarato nell'intestazione, e l'estensione ricavata dal
 * nome del file. Il primo si può dichiarare qualunque cosa; il secondo finiva
 * dentro il percorso di salvataggio sul nostro archivio.
 *
 * Adesso il tipo si legge dai byte e l'estensione dal tipo verificato.
 */

const jpeg = (extra: number[] = []) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...extra]);
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const webp = () =>
  new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
const pdf = () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

describe('un file è quello che dice di essere', () => {
  it('riconosce i quattro formati ammessi dai loro primi byte', () => {
    expect(tipoDaiPrimiByte(jpeg())).toBe('image/jpeg');
    expect(tipoDaiPrimiByte(png())).toBe('image/png');
    expect(tipoDaiPrimiByte(webp())).toBe('image/webp');
    expect(tipoDaiPrimiByte(pdf())).toBe('application/pdf');
  });

  it('un eseguibile presentato come immagine non passa', () => {
    // ELF: i primi byte di un eseguibile Linux. Prima passava, perché nessuno
    // guardava dentro: bastava dichiarare `image/jpeg`.
    const elf = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
    expect(laFirmaCombacia(elf, 'image/jpeg')).toBe(false);
    expect(tipoDaiPrimiByte(elf)).toBeNull();
  });

  it('uno script presentato come PDF non passa', () => {
    const script = new TextEncoder().encode('#!/bin/sh\nrm -rf /\n');
    expect(laFirmaCombacia(script, 'application/pdf')).toBe(false);
    expect(tipoDaiPrimiByte(script)).toBeNull();
  });

  it('un file vuoto o troncato non è nessun formato', () => {
    expect(tipoDaiPrimiByte(new Uint8Array([]))).toBeNull();
    expect(tipoDaiPrimiByte(new Uint8Array([0xff]))).toBeNull();
    expect(laFirmaCombacia(new Uint8Array([0xff, 0xd8]), 'image/jpeg')).toBe(false);
  });

  it('un tipo fuori dalla lista è rifiutato anche se la firma esistesse', () => {
    expect(laFirmaCombacia(jpeg(), 'image/gif')).toBe(false);
    expect(laFirmaCombacia(jpeg(), 'application/x-msdownload')).toBe(false);
  });

  it('l’estensione viene dal tipo, non dal nome scelto da chi carica', () => {
    // Il nome poteva essere qualunque cosa: quello che seguiva l'ultimo punto
    // finiva nel percorso di salvataggio senza nessuna lista bianca.
    expect(ESTENSIONE_PER_TIPO['image/jpeg']).toBe('jpg');
    expect(ESTENSIONE_PER_TIPO['application/pdf']).toBe('pdf');
    expect(Object.keys(ESTENSIONE_PER_TIPO).sort()).toEqual([
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
  });

  it('un WEBP con lunghezza diversa passa lo stesso (i byte in mezzo sono liberi)', () => {
    const grande = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0xff, 0xee, 0xdd, 0xcc, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(tipoDaiPrimiByte(grande)).toBe('image/webp');
  });
});

/**
 * 22/8/2026 — CONFRONTARE UN SEGRETO CON `===` DICE QUANTI CARATTERI HAI
 * AZZECCATO.
 *
 * Il confronto esce al primo carattere diverso, quindi il tempo di risposta
 * racconta quanti caratteri iniziali sono giusti. Misurando i tempi, il
 * segreto si ricostruisce da fuori senza mai vederlo.
 */
describe('i segreti si confrontano a tempo costante', () => {
  it('due segreti uguali combaciano', () => {
    expect(segretiCombaciano('abc123', 'abc123')).toBe(true);
  });

  it('due diversi no, nemmeno se il primo pezzo è uguale', () => {
    expect(segretiCombaciano('abc123', 'abc999')).toBe(false);
    expect(segretiCombaciano('abc123', 'abc1234')).toBe(false);
  });

  it('un segreto assente non combacia con niente', () => {
    expect(segretiCombaciano(null, 'abc')).toBe(false);
    expect(segretiCombaciano('abc', undefined)).toBe(false);
    expect(segretiCombaciano('', '')).toBe(false);
    expect(segretiCombaciano(null, null)).toBe(false);
  });

  it('estrae il gettone dall’intestazione, e niente da una malformata', () => {
    expect(gettoneBearer('Bearer abc123')).toBe('abc123');
    expect(gettoneBearer('bearer abc123')).toBe('abc123');
    expect(gettoneBearer('Bearer   abc123  ')).toBe('abc123');
    expect(gettoneBearer('Basic abc123')).toBeNull();
    expect(gettoneBearer('Bearer ')).toBeNull();
    expect(gettoneBearer(null)).toBeNull();
  });
});

/**
 * 22/8/2026 — IL COOKIE DEL RUOLO ERA FIRMATO CON LA CHIAVE DELLE DISISCRIZIONI.
 *
 * `segretoRuolo()` ripiegava su `UNSUBSCRIBE_SECRET` — la chiave che finisce
 * nel link in fondo a ogni email spedita. Una chiave che esce in ogni email non
 * è più un segreto, e chi la conosce può falsificare un cookie di ruolo.
 */
describe('il cookie del ruolo non usa la chiave delle email', () => {
  it('middleware.ts non ripiega più su UNSUBSCRIBE_SECRET', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const testo = readFileSync(join(__dirname, '..', '..', 'middleware.ts'), 'utf8');
    const riga = testo
      .split('\n')
      .find((r) => r.includes('MIDDLEWARE_CACHE_SECRET') && r.includes('return'));
    expect(riga, 'la riga che sceglie il segreto non si trova più').toBeTruthy();
    expect(riga).not.toContain('UNSUBSCRIBE_SECRET');
  });

  it('la variabile giusta è dichiarata in .env.example, così l’ambiente non resta senza', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const env = readFileSync(join(__dirname, '..', '..', '.env.example'), 'utf8');
    expect(env).toContain('MIDDLEWARE_CACHE_SECRET=');
  });
});
