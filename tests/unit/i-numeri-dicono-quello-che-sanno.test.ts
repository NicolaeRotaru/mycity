/**
 * 22/8/2026 — CINQUE MISURE CHE DICEVANO PIU' DI QUELLO CHE SAPEVANO.
 *
 * Un numero sbagliato in una tabella di analisi non fa cadere niente: fa
 * prendere decisioni storte, e non se ne accorge nessuno per mesi. Qui ci sono
 * le prove per tre di quei numeri.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { messaggioSenzaDatiPersonali } from '@/lib/analytics/events';
import { giornoPiacenza, inizioGiornoPiacenza } from '@/lib/tempo-piacenza';

afterEach(() => {
  vi.doUnmock('@/lib/analytics/posthog');
  vi.resetModules();
});

/**
 * Il prezzo di «prodotto visto» viaggiava in euro con la virgola, mentre
 * carrello, cassa e ordine viaggiano in centesimi interi. Tre su quattro
 * seguivano la regola. Chi scrive una domanda sui dati doveva ricordarsi
 * dell'eccezione, e prima o poi non se la ricorda.
 */
describe('il prezzo negli eventi', () => {
  it('«prodotto visto» manda centesimi interi, come gli altri tre', async () => {
    const inviati: Array<{ nome: string; props: Record<string, unknown> }> = [];
    vi.doMock('@/lib/analytics/posthog', () => ({
      track: (nome: string, props: Record<string, unknown>) => inviati.push({ nome, props }),
    }));
    vi.resetModules();
    const { trackProductViewed, trackAddToCart } = await import('@/lib/analytics/events');

    trackProductViewed('p1', { priceCents: 1990, category: 'casa' });
    trackAddToCart('p1', 1, 1990);

    const visto = inviati.find((e) => e.nome === 'product_viewed');
    const carrello = inviati.find((e) => e.nome === 'add_to_cart');
    expect(visto?.props.price_cents).toBe(1990);
    expect(carrello?.props.price_cents).toBe(1990);
    // La vecchia proprieta' in euro non deve tornare: due unita' sotto due nomi
    // sono il modo in cui i conti smettono di tornare.
    expect(visto?.props).not.toHaveProperty('price');
  });
});

/**
 * I confini dei mesi delle coorti erano mezzanotte nel fuso di CHI GUARDA. Le
 * iscrizioni sono a Greenwich. D'estate l'Italia e' due ore avanti: chi si
 * iscriveva alle 23 dell'ultimo giorno del mese finiva nella coorte sbagliata.
 */
describe('i confini dei mesi', () => {
  it('il primo agosto a Piacenza comincia due ore prima che a Greenwich', () => {
    const inizio = inizioGiornoPiacenza('2026-08-01');
    expect(inizio.toISOString()).toBe('2026-07-31T22:00:00.000Z');
    // E chi si iscrive alle 23:30 del 31 luglio ora italiana sta ancora in
    // luglio, non in agosto.
    const iscrizione = new Date('2026-07-31T21:30:00.000Z');
    expect(iscrizione < inizio).toBe(true);
    expect(giornoPiacenza(iscrizione)).toBe('2026-07-31');
  });

  it('in inverno lo scarto e\' di un\'ora sola, e la funzione lo sa', () => {
    expect(inizioGiornoPiacenza('2026-01-01').toISOString()).toBe('2025-12-31T23:00:00.000Z');
  });
});

/** La ricerca digitata passa dalla stessa pulizia degli errori. */
describe('la pulizia dei dati personali', () => {
  it('toglie email, identificativi e numeri lunghi', () => {
    expect(messaggioSenzaDatiPersonali('scrivi a mario@rossi.it')).not.toContain('@');
    expect(messaggioSenzaDatiPersonali('ordine 1234567890')).toContain('<numero>');
  });
});
