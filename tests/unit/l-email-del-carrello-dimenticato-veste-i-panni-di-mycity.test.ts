/**
 * 6/9/2026 — L'EMAIL DEL CARRELLO DIMENTICATO PARTIVA NUDA.
 *
 * Il cron dei carrelli abbandonati (`app/api/cron/abandoned-carts`) si scriveva
 * l'HTML da solo: quattro paragrafi, senza <html>, senza la testata col nome
 * MyCity e senza il piede coi link a preferenze, privacy e cookie. Font e
 * colori erano quelli di serie del programma di posta. Nello stesso momento, in
 * `lib/email/templates.ts`, esisteva gia' `abandoned_cart_4h` dentro il guscio
 * comune, e le due versioni portavano lo stesso tag: due case per lo stesso
 * messaggio, libere di divergere senza che nessuno se ne accorgesse.
 *
 * Chi lascia un carrello pieno riceve cosi' l'unica email che non somiglia ne'
 * al sito ne' alle altre nostre — proprio quella che deve riportarlo a pagare,
 * cioe' quella in cui la fiducia conta di piu'.
 *
 * Questa prova tiene fermi due punti: ① il messaggio esce dal guscio comune,
 * con testata e piede; ② il cron non se lo riscrive per conto suo.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { preparaEmailCicloDiVita } from '@/lib/email/templates';

const cron = readFileSync(join(process.cwd(), 'app/api/cron/abandoned-carts/route.ts'), 'utf8');

const messaggio = preparaEmailCicloDiVita('abandoned_cart_4h', {
  name: 'Marco Rossi',
  cartItems: [
    { name: 'Pane di Altamura', quantity: 2 },
    { name: '<script>alert(1)</script>Focaccia', quantity: 1 },
  ],
})!;

describe('① il messaggio esce vestito, come tutte le altre email', () => {
  it('e una pagina vera, non quattro paragrafi sciolti', () => {
    expect(messaggio.html.startsWith('<!doctype html>')).toBe(true);
  });

  it('porta la testata col nome MyCity', () => {
    expect(messaggio.html).toContain('>MyCity</div>');
  });

  it('porta il piede coi link che il Garante si aspetta', () => {
    expect(messaggio.html, 'manca il link alle preferenze').toContain('/profile/settings');
    expect(messaggio.html, 'manca il link alla privacy').toContain('/privacy');
    expect(messaggio.html, 'manca il link ai cookie').toContain('/cookies');
  });
});

describe('② dice chi e cosa, senza inventarsi un totale', () => {
  it('saluta per nome e elenca quello che era rimasto nel carrello', () => {
    expect(messaggio.html).toContain('Ciao Marco Rossi,');
    expect(messaggio.html).toContain('2× Pane di Altamura');
    expect(messaggio.text).toContain('2× Pane di Altamura');
  });

  it('filtra i nomi dei prodotti: li scrivono i negozi', () => {
    expect(messaggio.html).not.toContain('<script>');
  });

  it('non scrive nessun importo: il totale di allora puo’ non esistere piu’', () => {
    // Via i colori (#RRGGBB) e i pixel degli stili, resta il testo che legge la persona.
    const testo = messaggio.html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');
    expect(testo, 'e’ tornato un totale dentro il messaggio').not.toMatch(/\d+[.,]\d{2}\s*€|€\s*\d/);
  });

  it('senza carrello leggibile non si rompe: manda comunque il messaggio', () => {
    const vuoto = preparaEmailCicloDiVita('abandoned_cart_4h', { name: null, cartItems: null })!;
    expect(vuoto.html.startsWith('<!doctype html>')).toBe(true);
    expect(vuoto.html).toContain('Ciao,');
  });
});

describe('③ il cron non se lo riscrive per conto suo', () => {
  it('chiede il messaggio al template invece di comporre HTML a mano', () => {
    expect(cron, 'il cron non passa piu’ dal template comune').toContain(
      "preparaEmailCicloDiVita('abandoned_cart_4h'",
    );
  });

  it('nel cron non e’ rimasto HTML scritto a mano', () => {
    expect(cron, 'e’ tornato un <p> costruito nel cron').not.toMatch(/html:\s*`\s*<p>/);
    expect(cron, 'e’ tornato un colore scritto a mano nel cron').not.toMatch(/#[0-9A-Fa-f]{6}/);
  });
});
