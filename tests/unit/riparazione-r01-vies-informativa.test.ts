import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 27/11/2026 — L'INFORMATIVA NON DICEVA CHE LA PARTITA IVA DEL VENDITORE VA AL REGISTRO VIES.
 *
 * La verifica del Venditore (app/api/kyc/start-check/route.ts → viesVatLookup in
 * lib/kyc/providers.ts) manda la partita IVA a ec.europa.eu. Per una ditta individuale e' un
 * dato personale, e fra i destinatari dell'informativa (sezione 4) VIES non compariva.
 * Prova leggera: disegna la pagina /privacy vera e legge la sezione 4.
 */

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));

import PrivacyPage from '@/app/privacy/page';

function sezioneDestinatari(): string {
  const pagina = renderToStaticMarkup(createElement(PrivacyPage));
  const inizio = pagina.indexOf('4. Destinatari dei dati');
  const fine = pagina.indexOf('5. Diritti dell');
  expect(inizio, 'manca la sezione 4').toBeGreaterThan(-1);
  expect(fine).toBeGreaterThan(inizio);
  return pagina.slice(inizio, fine).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
}

describe('informativa, sezione 4: il registro VIES della Commissione europea', () => {
  it('il codice manda davvero la partita IVA a VIES (se cambia, cambia anche questa prova)', () => {
    const codice = readFileSync(join(process.cwd(), 'lib', 'kyc', 'providers.ts'), 'utf8');
    expect(codice).toContain('ec.europa.eu/taxation_customs/vies');
  });

  it('fra i destinatari c’è la Commissione europea (VIES), con cosa riceve', () => {
    const testo = sezioneDestinatari();
    const riga = testo.slice(testo.indexOf('Commissione europea (VIES)'));
    expect(testo).toContain('Commissione europea (VIES)');
    expect(riga.slice(0, 600)).toMatch(/partita IVA/);
    expect(riga.slice(0, 600)).toMatch(/Venditore/);
  });
});
