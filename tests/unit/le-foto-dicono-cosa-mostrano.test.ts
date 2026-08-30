/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * 27/8/2026 (R117) — LO STESSO NOME DETTO TRE VOLTE, E TRE FOTO DIVERSE
 * CHIAMATE TUTTE ALLO STESSO MODO.
 *
 * ① Nella griglia dei prodotti, ogni scheda ha un link invisibile che copre
 * tutta la card e porta già il nome del prodotto (più «esaurito», «scontato
 * del 30 per cento», «novità»), poi il titolo scritto nell'intestazione, e in
 * mezzo la foto con `alt` uguale al nome. Chi ascolta una pagina con venti
 * prodotti si sentiva ripetere sessanta volte gli stessi nomi. Una foto che
 * illustra una cosa già nominata lì accanto non va descritta: va lasciata muta
 * (`alt=""`), che è la regola di WCAG per le immagini decorative.
 *
 * ② Le foto caricate dalle persone — quelle di una recensione, quelle allegate
 * a una richiesta di reso — avevano tutte lo stesso testo alternativo: «Foto
 * recensione», «prova». Tre foto di fila e un lettore di schermo che dice tre
 * volte la stessa parola: non si capisce nemmeno che sono tre foto diverse.
 * Non possiamo sapere cosa c'è dentro una foto caricata da un cliente, ma
 * possiamo almeno numerarle.
 */

describe('la foto della scheda prodotto nella griglia', () => {
  it('non ripete il nome del prodotto che il link accanto ha già detto', async () => {
    const mod = await monta('components/ProductCard.tsx');
    const s = accendi(mod.default, {
      id: 'p1',
      name: 'Focaccia di Recco',
      price: 6.5,
      images: ['https://esempio.it/focaccia.jpg'],
      storeName: 'Pane Quotidiano',
      sellerId: 's1',
    });

    const link = s.radice.querySelector('a[aria-label]')!;
    expect(link.getAttribute('aria-label'), 'Il link della card deve continuare a dire il nome').toContain('Focaccia di Recco');

    const foto = s.radice.querySelector('img')!;
    expect(foto, 'La foto del prodotto è sparita dalla scheda').toBeTruthy();
    expect(
      foto.getAttribute('alt'),
      'Il nome del prodotto veniva detto tre volte per ogni scheda: link, foto e titolo. La foto illustra una cosa già nominata, quindi resta muta.',
    ).toBe('');
    s.smonta();
  }, 60000);
});

describe('le foto caricate dalle persone', () => {
  it('le foto di una recensione si distinguono l\'una dall\'altra', async () => {
    const mod = await monta('components/store-sections/ReviewsSection.tsx');
    const s = accendi(mod.default, {
      ctx: {
        accent: '#C0492C',
        reviews: [
          {
            id: 'r1',
            rating: 5,
            comment: 'Ottima',
            created_at: '2026-08-01T10:00:00Z',
            order_id: null,
            helpful_count: 0,
            photo_urls: ['https://esempio.it/a.jpg', 'https://esempio.it/b.jpg', 'https://esempio.it/c.jpg'],
            author: null,
            seller_reply: null,
          },
        ],
      },
    });

    const testi = Array.from(s.radice.querySelectorAll('img')).map((i) => i.getAttribute('alt'));
    expect(testi.length, 'Le tre foto della recensione non ci sono più').toBe(3);
    expect(
      new Set(testi).size,
      `Tre foto diverse, tre volte lo stesso testo: ${JSON.stringify(testi)}. Chi ascolta non capisce nemmeno che sono tre.`,
    ).toBe(3);
    s.smonta();
  }, 60000);
});
