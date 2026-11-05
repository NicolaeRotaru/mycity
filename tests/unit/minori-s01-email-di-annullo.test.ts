import { describe, it, expect } from 'vitest';
import { ordineAnnullatoTemplate } from '@/lib/email/templates';

/**
 * S01 — l'email di annullo.
 *  · 2223: le cifre nuove del carrello stanno dentro il riquadro (prima del piè
 *    di pagina) e chi ha pagato con la carta non legge «non devi pagare niente».
 *  · 1907: chi annulla da solo non riceve l'email del rifiuto del negozio.
 */
const ID = 'a1b2c3d4-0000-4000-8000-000000000001';

describe('2223 — le cifre del carrello e la frase sui soldi', () => {
  it('le righe del carrello vengono prima del piè di pagina', () => {
    const t = ordineAnnullatoTemplate({
      orderId: ID, motivo: 'Rifiutato dal negozio', come: 'contanti',
      carrello: { html: '<p>alla porta paghi 15 € invece di 13</p>', text: 'alla porta paghi 15 € invece di 13' },
    });
    expect(t.html.indexOf('alla porta paghi')).toBeGreaterThan(0);
    expect(t.html.indexOf('alla porta paghi')).toBeLessThan(t.html.indexOf('Hai ricevuto questa email'));
    expect(t.subject).not.toMatch(/non devi pagare niente/);
  });
  it('con la carta: niente «non devi pagare niente», si dice che il rimborso torna sulla carta', () => {
    const t = ordineAnnullatoTemplate({
      orderId: ID, come: 'carta',
      carrello: { html: '<p>ti tornano 16 €</p>', text: 'ti tornano 16 €' },
    });
    expect(t.subject).not.toMatch(/non devi pagare niente/i);
    expect(t.text).not.toMatch(/non devi pagare niente/i);
    expect(t.text).toMatch(/torna sulla carta/);
  });
  it('controprova: contanti senza carrello resta come prima', () => {
    const t = ordineAnnullatoTemplate({ orderId: ID, motivo: 'pane finito' });
    expect(t.subject).toMatch(/non devi pagare niente/);
  });
});

describe('1907 — chi annulla da solo', () => {
  it('niente «Motivo: Ordine annullato dal cliente» né «Cerca in un altro negozio»', () => {
    const t = ordineAnnullatoTemplate({ orderId: ID, motivo: 'Ordine annullato dal cliente', annullatoDalCliente: true });
    expect(t.html).not.toContain('Motivo:');
    expect(t.html).not.toContain('Cerca in un altro negozio');
    expect(t.html).toContain('Hai annullato il tuo ordine');
  });
  it('l annullo del cliente lo dice all email (fonte buyer_cancel)', async () => {
    const { readFileSync } = await import('node:fs');
    const s = readFileSync('lib/ordini/annulla.ts', 'utf8');
    expect(s.match(/annullatoDalCliente: opts\.metadata\?\.source === 'buyer_cancel'/g)?.length).toBe(2);
  });
});
