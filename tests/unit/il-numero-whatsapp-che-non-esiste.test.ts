/**
 * Sei punti di contatto WhatsApp portavano tutti a un numero che non esiste.
 *
 * IL CASO. `393000000000` — un tre seguito da zeri. Chi lo tocca apre WhatsApp su un contatto
 * inesistente. E chi lo tocca è qualcuno che stava cercando aiuto.
 *
 * **La scheda ne aveva contati due**, tutt'e due nel piè di pagina. Contandoli sono **sei**, e i
 * quattro in più stanno esattamente dove va chi ha un problema: `/contact`, `/help`,
 * `/seller/help`, `/rider/help`. Su `/contact` il numero finto non era nemmeno solo un link:
 * era **stampato a video** come se fosse vero, «+39 300 000 0000», su una pagina che si chiama
 * «Contattaci».
 *
 * LA CURA C'ERA GIÀ NELLO STESSO FILE. I dati legali del titolare si stampano solo se esistono
 * davvero, e il commento accanto racconta perché: prima c'erano una sede, una P.IVA di soli zeri e
 * una PEC inventati, su ogni pagina. Stessa regola qui — **un'icona in meno è meglio di un'icona
 * che porta nel vuoto.**
 *
 * PERCHÉ NON BASTA «SE LA VARIABILE È VUOTA». Il valore di ripiego ERA il segnaposto. Se domani
 * qualcuno riempie la variabile copiandoci dentro il valore d'esempio — il modo più naturale di
 * sbagliare — il controllo «è vuota?» direbbe di sì e il numero finto tornerebbe a video.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SEGNAPOSTO, linkWhatsApp, numeroWhatsApp } from '@/lib/contatto-whatsapp';

// ─────────────────────────────────────────────────────────────────────────────
// ① Riconoscere un numero che non esiste.
// ─────────────────────────────────────────────────────────────────────────────

describe('il numero', () => {
  it('un numero vero passa, ripulito da spazi e simboli', () => {
    expect(numeroWhatsApp('+39 333 123 4567')).toBe('393331234567');
    expect(numeroWhatsApp('39-333-1234567')).toBe('393331234567');
  });

  it('IL CASO: il segnaposto non è un numero', () => {
    expect(numeroWhatsApp(SEGNAPOSTO)).toBeNull();
    expect(numeroWhatsApp('+39 300 000 0000')).toBeNull();
  });

  it('e nemmeno le sue varianti scritte a mano copiando l\'esempio', () => {
    // Un numero vero non è tutto zeri dopo il prefisso. Un segnaposto sì, comunque lo si scriva.
    for (const finto of ['390000000000', '39 000 000 0000', '3900000000']) {
      expect(numeroWhatsApp(finto), finto).toBeNull();
    }
  });

  it('non configurato è «non ce l\'ho», non una stringa vuota da mostrare', () => {
    for (const niente of ['', '   ', undefined, null, 'abc']) {
      expect(numeroWhatsApp(niente), String(niente)).toBeNull();
    }
  });

  it('troppo corto per essere un telefono: è un refuso, non un numero', () => {
    expect(numeroWhatsApp('3331234')).toBeNull();
    expect(numeroWhatsApp('39')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② Il link, o niente link.
// ─────────────────────────────────────────────────────────────────────────────

describe('il link', () => {
  it('con un numero vero si costruisce, col testo già pronto', () => {
    const l = linkWhatsApp('+39 333 123 4567', 'Ciao MyCity');
    expect(l).toContain('https://wa.me/393331234567');
    expect(l).toContain('text=');
  });

  it('IL CASO: senza un numero vero non c\'è nessun link, e l\'ancora non si disegna', () => {
    expect(linkWhatsApp(SEGNAPOSTO, 'Ciao')).toBeNull();
    expect(linkWhatsApp('', 'Ciao')).toBeNull();
    expect(linkWhatsApp(undefined)).toBeNull();
  });

  it('senza testo il link resta pulito', () => {
    expect(linkWhatsApp('393331234567')).toBe('https://wa.me/393331234567');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ L'invariante: il segnaposto non torna in nessuna delle sei pagine.
// ─────────────────────────────────────────────────────────────────────────────

const PAGINE = [
  'components/Footer.tsx',
  'app/contact/page.tsx',
  'app/help/page.tsx',
  'app/seller/help/page.tsx',
  'app/rider/help/page.tsx',
];

describe('l\'invariante sulle pagine vere', () => {
  it('IL CASO: nessuna pagina manda più su wa.me col numero finto', () => {
    for (const f of PAGINE) {
      const src = readFileSync(join(process.cwd(), f), 'utf8');
      const senzaCommenti = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');
      expect(senzaCommenti, `${f} manda ancora su un numero inesistente`)
        .not.toMatch(new RegExp(`wa\\.me/${SEGNAPOSTO}`));
    }
  });

  it('e nessuna lo tiene come valore di ripiego', () => {
    // La forma malata: `process.env.X ?? '393000000000'`, che è il modo in cui il difetto
    // sopravviveva alla variabile d'ambiente.
    for (const f of PAGINE) {
      const src = readFileSync(join(process.cwd(), f), 'utf8');
      const senzaCommenti = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');
      expect(senzaCommenti, `${f} ha ancora il segnaposto come ripiego`)
        .not.toMatch(new RegExp(`\\?\\?\\s*'${SEGNAPOSTO}'`));
    }
  });

  it('ognuna passa dalla funzione che decide, e mostra il contatto solo se c\'è', () => {
    for (const f of PAGINE) {
      const src = readFileSync(join(process.cwd(), f), 'utf8');
      expect(src, `${f} non usa linkWhatsApp`).toMatch(/linkWhatsApp\(/);
      expect(src, `${f} non nasconde il contatto quando manca`).toMatch(/whatsapp &&/);
    }
  });

  it('su «Contattaci» il numero finto non è più stampato a video', () => {
    // I commenti si tolgono: quello che spiega la riparazione CITA il numero vecchio, ed è giusto
    // che lo citi. Un falso rosso su un proprio commento è già successo in questo lotto.
    const src = readFileSync(join(process.cwd(), 'app/contact/page.tsx'), 'utf8');
    const senzaCommenti = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');
    expect(senzaCommenti, 'il numero finto era scritto come se fosse vero').not.toMatch(/\+39 300 000 0000/);
  });
});
