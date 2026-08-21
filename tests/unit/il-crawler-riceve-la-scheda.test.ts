import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * #83 — LA SCHEDA PRODOTTO ARRIVAVA AL CRAWLER SENZA CONTENUTO NELL'HTML.
 *
 * I dati strutturati — nome, prezzo, disponibilità, negozio — erano scritti
 * dentro la pagina, che è un componente client: esistono solo dopo che il
 * JavaScript è stato scaricato e avviato. Google esegue il JavaScript, ma in
 * una seconda passata e non sempre: un prezzo che compare al secondo giro è un
 * prezzo che nei risultati può mancare.
 *
 * Il guscio della pagina è invece un componente server, e quello che scrive
 * finisce nell'HTML subito. Questa prova controlla che ci sia rimasto.
 */

const GUSCIO = join(process.cwd(), 'app/product/[id]/layout.tsx');
const PAGINA = join(process.cwd(), 'app/product/[id]/page.tsx');

describe('i dati strutturati del prodotto stanno nel guscio, non nella pagina', () => {
  it('il guscio li scrive, ed è un componente server', () => {
    const guscio = readFileSync(GUSCIO, 'utf8');
    expect(guscio).not.toMatch(/^'use client'/);
    expect(guscio).toContain('application/ld+json');
    expect(guscio).toContain("'@type': 'Product'");
    // Le tre cose che il crawler deve trovare nella scheda.
    expect(guscio).toContain('priceCurrency');
    expect(guscio).toContain('availability');
    expect(guscio).toContain('LocalBusiness');
  });

  it('la pagina client non li scrive più: sarebbero doppi e arriverebbero tardi', () => {
    const pagina = readFileSync(PAGINA, 'utf8');
    expect(pagina).toMatch(/^'use client'/);
    expect(pagina).not.toContain("'@type': 'Product'");
  });

  it('la disponibilità dice il vero anche a scorta finita', () => {
    const guscio = readFileSync(GUSCIO, 'utf8');
    // Dichiarare «disponibile» un prodotto esaurito è una segnalazione a Google
    // che poi fa arrivare gente su una pagina che non può vendere.
    expect(guscio).toContain('OutOfStock');
    expect(guscio).toContain('stock');
  });
});
