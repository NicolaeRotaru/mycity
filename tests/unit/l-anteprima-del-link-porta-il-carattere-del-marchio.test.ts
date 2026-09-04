import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  caratteriDelMarchio,
  FILE_DEL_CARATTERE,
  MARCHIO_FONT_FAMILY,
  MARCHIO_FONT_WEIGHT,
} from '@/app/carattere-del-marchio';

/**
 * 3/9/2026 — IL LOGO NELL'ANTEPRIMA DEL LINK NON ERA IL NOSTRO.
 *
 * Chiara incolla un link di MyCity nel gruppo WhatsApp del quartiere. WhatsApp
 * mostra l'immagine di anteprima che disegniamo noi: sfondo terracotta, e la
 * scritta «MyCity» in grande. Quella scritta chiedeva `system-ui` a peso 900 e
 * a chi disegna l'immagine non veniva passato NESSUN carattere: usciva quindi
 * nel carattere di riserva (Noto Sans), non nel Fraunces del logotipo. Il peso
 * 900, poi, nel prodotto non esiste: `app/layout.tsx` carica Fraunces dal 400
 * all'800.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────
 * Non cerca la parola «Fraunces» nel sorgente: quella si trova anche in una
 * riga di import, e resterebbe verde col difetto rimesso. Qui si ESEGUE il
 * caricamento e si APRE il file del carattere, leggendone le tabelle interne
 * («name» e «OS/2») come farebbe chi lo disegna: se domani quel file sparisce,
 * si corrompe o viene sostituito con un altro carattere o con un altro peso,
 * questa prova diventa rossa.
 *
 * L'altra metà è la rete di sicurezza: se il file non si legge, l'anteprima
 * deve venire lo stesso. Un logo nel carattere sbagliato è un difetto; nessuna
 * anteprima del link è un danno.
 *
 * ⚪ Da qui non compilo il pacchetto «edge» e non incollo un link in WhatsApp:
 * verifico il carattere che consegniamo e cosa succede se manca, non il PNG che
 * esce dal server di Vercel.
 */

const PERCORSO_TTF = fileURLToPath(FILE_DEL_CARATTERE);
const BYTE = readFileSync(PERCORSO_TTF);

/** Legge dal file del carattere le tabelle interne, come fa chi lo disegna. */
function tabelle(dati: Buffer): Map<string, { inizio: number; lunghezza: number }> {
  const quante = dati.readUInt16BE(4);
  const trovate = new Map<string, { inizio: number; lunghezza: number }>();
  for (let i = 0; i < quante; i++) {
    const r = 12 + 16 * i;
    trovate.set(dati.toString('latin1', r, r + 4), {
      inizio: dati.readUInt32BE(r + 8),
      lunghezza: dati.readUInt32BE(r + 12),
    });
  }
  return trovate;
}

/** Il nome della famiglia dichiarato dentro il carattere (tabella «name», voce 1). */
function nomeDellaFamiglia(dati: Buffer): string {
  const name = tabelle(dati).get('name');
  if (!name) throw new Error('il file non ha la tabella «name»: non è un carattere');
  const quanti = dati.readUInt16BE(name.inizio + 2);
  const testi = name.inizio + dati.readUInt16BE(name.inizio + 4);
  for (let i = 0; i < quanti; i++) {
    const r = name.inizio + 6 + 12 * i;
    const piattaforma = dati.readUInt16BE(r);
    const voce = dati.readUInt16BE(r + 6);
    if (voce !== 1) continue;
    const lunghezza = dati.readUInt16BE(r + 8);
    const dove = testi + dati.readUInt16BE(r + 10);
    const grezzo = dati.subarray(dove, dove + lunghezza);
    if (piattaforma !== 3) return grezzo.toString('latin1');
    // Piattaforma Windows: UTF-16 col byte grande per primo. Node sa leggere
    // solo il verso opposto, quindi le coppie si girano prima.
    const girato = Buffer.from(grezzo);
    girato.swap16();
    return girato.toString('utf16le');
  }
  return '';
}

/** Il peso dichiarato dentro il carattere (tabella «OS/2», usWeightClass). */
function pesoDichiarato(dati: Buffer): number {
  const os2 = tabelle(dati).get('OS/2');
  if (!os2) throw new Error('il file non ha la tabella «OS/2»');
  return dati.readUInt16BE(os2.inizio + 4);
}

const leggiDaDisco = async () => {
  const b = readFileSync(PERCORSO_TTF);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe('il carattere che consegniamo all’anteprima', () => {
  it('c’è, ed è un vero file di carattere', () => {
    expect(PERCORSO_TTF).toMatch(/Fraunces-ExtraBold\.ttf$/);
    expect(BYTE.byteLength, 'il file è vuoto o troncato').toBeGreaterThan(20_000);
    // Firma di un TrueType: 0x00010000.
    expect(BYTE.readUInt32BE(0)).toBe(0x00010000);
    expect([...tabelle(BYTE).keys()]).toEqual(expect.arrayContaining(['name', 'OS/2', 'glyf', 'cmap']));
  });

  it('dentro dichiara di essere Fraunces, al peso 800 del marchio', () => {
    // Il logotipo ufficiale (docs/mockup/assets/wordmark-light.svg) dice
    // font-family="Fraunces, Georgia, serif" e font-weight="800".
    const famiglia = nomeDellaFamiglia(BYTE);
    expect(famiglia, `il file dichiara di essere «${famiglia}»`).toMatch(/^Fraunces\b/);
    expect(famiglia).toMatch(/ExtraBold/i);
    expect(pesoDichiarato(BYTE), 'il peso scritto dentro il carattere non è quello del marchio').toBe(800);
    expect(MARCHIO_FONT_WEIGHT, 'il peso 900 non esiste: la scala del design si ferma a 800').toBe(800);
    expect(MARCHIO_FONT_FAMILY).toBe('Fraunces');
  });

  it('viene consegnato col nome e il peso giusti, e coi byte veri', async () => {
    const caratteri = await caratteriDelMarchio(leggiDaDisco);
    expect(caratteri, 'nessun carattere consegnato: il marchio uscirebbe in quello di riserva').toBeTruthy();
    expect(caratteri).toHaveLength(1);
    expect(caratteri![0].name).toBe('Fraunces');
    expect(caratteri![0].weight).toBe(800);
    expect(caratteri![0].style).toBe('normal');
    expect(caratteri![0].data.byteLength).toBe(BYTE.byteLength);
    expect(nomeDellaFamiglia(Buffer.from(caratteri![0].data))).toMatch(/^Fraunces\b/);
  });
});

describe('se il carattere non si legge, l’anteprima viene lo stesso', () => {
  it('un errore di lettura non fa saltare l’immagine', async () => {
    const rotto = async () => {
      throw new Error('il pacchetto non contiene il file');
    };
    await expect(caratteriDelMarchio(rotto)).resolves.toBeUndefined();
  });

  it('un file vuoto vale come nessun carattere', async () => {
    await expect(caratteriDelMarchio(async () => new ArrayBuffer(0))).resolves.toBeUndefined();
  });

  it('quando manca si consegna «niente», non un elenco vuoto', async () => {
    // Chi disegna l'immagine sceglie con `options.fonts || defaultFonts`, e in
    // JavaScript un elenco vuoto è VERO: consegnare `[]` vorrebbe dire «al
    // mondo non esiste nessun carattere» e l'anteprima non verrebbe più.
    const niente = await caratteriDelMarchio(async () => {
      throw new Error('via');
    });
    expect(niente, 'un elenco vuoto ucciderebbe l’anteprima invece di salvarla').toBeUndefined();
    expect(Array.isArray(niente)).toBe(false);
  });
});

describe('la pagina dell’anteprima chiede davvero quel carattere', () => {
  const SORGENTE = readFileSync(join(process.cwd(), 'app/opengraph-image.tsx'), 'utf8');

  it('passa i caratteri a chi disegna l’immagine', () => {
    const opzioni = SORGENTE.slice(SORGENTE.lastIndexOf('{ ...size'));
    expect(opzioni, 'a chi disegna l’immagine non arriva nessun carattere').toMatch(/\bfonts\b/);
    expect(SORGENTE).toMatch(/await caratteriDelMarchio\(\)/);
  });

  it('la scritta del marchio chiede Fraunces e il peso 800', () => {
    // Il blocco del logotipo è quello che contiene «My» e «City».
    const marchio = SORGENTE.slice(SORGENTE.lastIndexOf('<div', SORGENTE.indexOf('>My<')), SORGENTE.indexOf('>My<'));
    expect(marchio, 'il marchio non chiede nessuna famiglia di carattere').toMatch(/fontFamily:\s*MARCHIO_FONT_FAMILY/);
    expect(marchio, 'il marchio non chiede il peso del marchio').toMatch(/fontWeight:\s*MARCHIO_FONT_WEIGHT/);
    expect(marchio, 'il peso 900 non esiste in Fraunces né nella scala del design').not.toMatch(/fontWeight:\s*900/);
  });
});
