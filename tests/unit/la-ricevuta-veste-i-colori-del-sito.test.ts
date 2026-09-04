import { describe, it, expect } from 'vitest';
import { contrasto } from './aiuti/contrasto';
import { COLORI_DEL_SITO, colore, esadecimaliIn } from './aiuti/tavolozza-del-sito';
import {
  orderConfirmedBuyerTemplate,
  newOrderSellerTemplate,
  orderReadyTemplate,
  orderDeliveredTemplate,
  refundIssuedTemplate,
  giftCardRecipientTemplate,
  giftCardBuyerTemplate,
  preparaEmailCicloDiVita,
} from '@/lib/email/templates';

/**
 * 3/9/2026 — LA RICEVUTA ARRIVAVA NEI COLORI DI UN ALTRO SITO.
 *
 * Giulia ordina da Pane Quotidiano, paga, e sulla pagina ha appena visto
 * terracotta e panna. La conferma che le arriva in posta ha la testata blu
 * indigo: era `BRAND_COLOR = '#4f46e5'`, il colore della vecchia veste, rimasto
 * scritto a mano dentro `lib/email/templates.ts` il giorno in cui il sito è
 * passato a terracotta. Con lui altri sette grigi e verdi della stessa vecchia
 * tavolozza. Un messaggio che non somiglia al posto dove hai appena pagato è il
 * primo segnale che si insegna a riconoscere per fiutare una truffa: si ignora,
 * o si segna come posta indesiderata. E succede su OGNI ordine — conferma al
 * cliente, avviso al negozio, ordine pronto, consegnato, rimborso, buono
 * regalo, benvenuto, carrello.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────
 * Non cerca la parola «terracotta» dentro il sorgente. COSTRUISCE davvero ogni
 * messaggio, ne estrae ogni colore scritto nell'HTML, e li confronta con la
 * tavolozza vera LETTA da `tailwind.config.ts`, che è l'unico posto dove il
 * design del sito è dichiarato. `tailwind.config.ts` non si può importare dal
 * server della posta (non ha il CSS): è questa prova a tenere agganciate le due
 * cose. Il giorno in cui qualcuno rimette un colore inventato in un messaggio,
 * oppure cambia la tavolozza e si dimentica la posta, questa prova diventa
 * rossa.
 *
 * ⚪ Da qui non apro Gmail né Outlook: verifico i colori che escono da noi, non
 * come li rende ogni programma di posta.
 */

/* ── Tutti i messaggi che MyCity spedisce davvero ────────────────────────── */

const ORDINE = '7f3a1c9e-2b44-4d18-9a01-5e6f7a8b9c0d';

const MESSAGGI: Array<{ nome: string; html: string }> = [
  { nome: 'ordine ricevuto', html: orderConfirmedBuyerTemplate({ name: 'Giulia', orderId: ORDINE, total: 23.5, storeName: 'Pane Quotidiano' }).html },
  { nome: 'nuovo ordine al negozio', html: newOrderSellerTemplate({ sellerName: 'Pane Quotidiano', orderId: ORDINE, total: 23.5, itemsCount: 3 }).html },
  { nome: 'ordine pronto (ritiro)', html: orderReadyTemplate({ orderId: ORDINE, pickupInStore: true, storeName: 'Pane Quotidiano', storeAddress: 'via Roma 1', pickupCode: 'A7K2' }).html },
  { nome: 'ordine pronto (consegna)', html: orderReadyTemplate({ orderId: ORDINE, pickupInStore: false, storeName: 'Pane Quotidiano' }).html },
  { nome: 'ordine consegnato', html: orderDeliveredTemplate({ orderId: ORDINE, name: 'Giulia', total: 23.5 }).html },
  { nome: 'rimborso emesso', html: refundIssuedTemplate({ orderId: ORDINE, amount: 12, reason: 'prodotto esaurito' }).html },
  { nome: 'buono regalo a chi lo riceve', html: giftCardRecipientTemplate({ code: 'MC-4821', amountEuro: 50, senderName: 'Marco', message: 'Buon compleanno' }).html },
  { nome: 'buono regalo a chi lo compra', html: giftCardBuyerTemplate({ code: 'MC-4821', amountEuro: 50, recipientName: 'Chiara' }).html },
];

// I messaggi del ciclo di vita passano dalla stessa impaginazione: se ne nasce
// uno nuovo, entra qui dentro da solo.
for (const nome of ['welcome', 'tutorial_day2', 'first_order_promo', 'reengagement_14d', 'winback_60d', 'abandoned_cart_4h', 'order_ready', 'order_delivered']) {
  const pronta = preparaEmailCicloDiVita(nome, { name: 'Giulia', orderId: ORDINE, totalEuro: 23.5, pickupInStore: false });
  expect(pronta, `il messaggio «${nome}» non si costruisce più`).toBeTruthy();
  MESSAGGI.push({ nome: `ciclo di vita: ${nome}`, html: pronta!.html });
}

describe('i colori che escono dalla posta sono quelli del sito', () => {
  it('la tavolozza si legge davvero da tailwind.config.ts', () => {
    // Se il lettore smette di leggere, tutto il resto diventerebbe verde per
    // finta: qui si controlla che la rete abbia ancora le maglie.
    expect(COLORI_DEL_SITO.size).toBeGreaterThan(40);
    expect(colore('primary-700')).toBe('#A03B25');
  });

  for (const { nome, html } of MESSAGGI) {
    it(`«${nome}»: nessun colore fuori tavolozza`, () => {
      const fuori = [...new Set(esadecimaliIn(html))].filter((hex) => !COLORI_DEL_SITO.has(hex));
      expect(
        fuori,
        `«${nome}» esce con colori che nel sito non esistono: ${fuori.join(' ')}`,
      ).toEqual([]);
    });
  }

  it('la testata porta la terracotta del sito, non un colore qualsiasi', () => {
    // Non basta «un colore della tavolozza»: la fascia col marchio è la prima
    // cosa che si vede, e deve essere la stessa terracotta del pulsante che
    // porta i soldi (--color-cta = primary-700).
    for (const { nome, html } of MESSAGGI) {
      const testata = html.match(/padding:24px 32px;background:(#[0-9A-Fa-f]{6})/);
      expect(testata, `«${nome}» ha perso la fascia col marchio`).toBeTruthy();
      expect(testata![1].toUpperCase(), `«${nome}»`).toBe(colore('primary-700'));
    }
  });

  it('lo sfondo è la panna del sito e il piede la sua fascia più scura', () => {
    const html = MESSAGGI[0].html;
    expect(html).toContain(`background:${colore('cream-100')}`);
    expect(html).toContain(`background:${colore('cream-200')}`);
  });

  it('«consegnato» è il verde oliva del sito, non l’emerald di un altro tema', () => {
    const consegnato = orderDeliveredTemplate({ orderId: ORDINE, name: 'Giulia', total: 23.5 }).html;
    const titolo = consegnato.match(/font-weight:700;color:(#[0-9A-Fa-f]{6})/);
    expect(titolo![1].toUpperCase()).toBe(colore('olive-600'));
  });

  it('il carattere del sito viene chiesto per primo', () => {
    for (const { nome, html } of MESSAGGI) {
      const famiglia = html.match(/font-family:([^;"]+)/);
      expect(famiglia, `«${nome}» non dichiara nessun carattere`).toBeTruthy();
      expect(famiglia![1].trim().toLowerCase(), `«${nome}»`).toMatch(/^inter\b/);
    }
  });
});

/* ── Un colore di marca che non si legge resta un difetto ────────────────── */

describe('le scritte della posta si leggono', () => {
  it('il rapporto sale sopra 4,5 sulle tre coppie che portano il testo', () => {
    const coppie: Array<[string, string, string]> = [
      ['il marchio sulla testata', '#FFFFFF', colore('primary-700')],
      ['il testo del piede', colore('ink-500'), colore('cream-200')],
      ['il corpo del messaggio', colore('ink-800'), '#FFFFFF'],
    ];
    for (const [dove, testo, sfondo] of coppie) {
      expect(contrasto(testo, sfondo), `${dove}: ${testo} su ${sfondo}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
