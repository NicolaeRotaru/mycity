import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * R29-012 — La consegna da 3 € aveva ancora altri nomi: «Costo di consegna» su Stripe, «Consegna
 * a domicilio» nel riquadro della cassa, «Consegna a casa» nelle promesse. Chi legge due nomi
 * pensa a due costi. Il nome ufficiale è uno, `VOCE_CONSEGNA` in lib/promesse-pubbliche.ts
 * («Consegna MyCity»): lo usano il riepilogo, il carrello, la pagina dell'ordine, e adesso anche il
 * riquadro della cassa, la voce di Stripe e la promessa della consegna gratuita.
 */

const leggi = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');
/** Il testo senza i commenti: un nome vecchio citato in una nota non è un nome mostrato. */
const senzaCommenti = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('R29-012 — la consegna ha un nome solo', () => {
  it('il nome ufficiale è Consegna MyCity, in una costante', () => {
    expect(leggi('lib/promesse-pubbliche.ts')).toMatch(/export const VOCE_CONSEGNA = 'Consegna MyCity';/);
  });

  it.each([
    ['app/checkout/page.tsx', /Consegna a domicilio/],
    ['lib/stripe/client.ts', /Costo di consegna/i],
    ['lib/promesse-pubbliche.ts', /Consegna a casa gratuita/],
  ])('%s non chiama la consegna con un altro nome', (file, vecchio) => {
    expect(senzaCommenti(leggi(file))).not.toMatch(vecchio);
  });

  it('il riquadro della cassa, la voce di Stripe e la promessa gratuita prendono il nome dalla costante', () => {
    expect(leggi('app/checkout/page.tsx')).toMatch(/<p className="font-bold text-ink-900">\{VOCE_CONSEGNA\}<\/p>/);
    expect(leggi('lib/stripe/client.ts')).toMatch(/name: `\$\{VOCE_CONSEGNA\} — \$\{g\.storeName\}`/);
    expect(leggi('lib/promesse-pubbliche.ts')).toMatch(/\? `\$\{VOCE_CONSEGNA\} gratuita`/);
  });
});
