import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as modelli from '@/lib/email/templates';

/**
 * 27/10/2026 — «3 COSE DA SAPERE» PROMETTEVA IL RITIRO IN NEGOZIO, CHE AL LANCIO E' SPENTO.
 *
 * La guida del secondo giorno parte a ogni nuovo cliente, anche a chi ha detto no alla
 * pubblicita' (e' un modello di servizio), e scriveva «oppure la ritiri tu se il negozio lo
 * permette». Il ritiro e' spento per tutti (`RITIRO_IN_NEGOZIO_ATTIVO` vale `false`, le rotte
 * che creano l'ordine forzano `pickupInStore = false`, la cassa non lo mostra) e nessun negozio
 * ha un'impostazione per «permetterlo»: il cliente cercava in cassa un'opzione che non c'e', e
 * la frase dava la colpa del no al negozio.
 *
 * La prova di prima sulla stessa mail cercava solo parole di soldi. Qui l'interruttore lo guida
 * la prova: spento, NESSUN modello di email che il file esporta nomina il ritiro; acceso, la
 * guida lo dice, senza una condizione che nessun negozio puo' scegliere.
 */
const interruttore = vi.hoisted(() => ({ ritiroAttivo: false }));

vi.mock('@/lib/constants', async (importOriginal) => {
  const vero = await importOriginal<typeof import('@/lib/constants')>();
  return {
    ...vero,
    get RITIRO_IN_NEGOZIO_ATTIVO() {
      return interruttore.ritiroAttivo;
    },
  };
});

const ORDINE = 'a1b2c3d4-0000-4000-8000-000000000001';

/** Gli argomenti di tutti i modelli insieme: ognuno prende i suoi e ignora gli altri. */
const ESSENZIALI = {
  orderId: ORDINE,
  ordineId: ORDINE,
  total: 24.5,
  amount: 24.5,
  itemsCount: 3,
  storeName: 'Pane Quotidiano',
  // A ritiro spento nessun ordine nasce «da ritirare»: le due rotte che lo creano lo forzano a falso.
  pickupInStore: false,
  bonificoCents: 500,
  testo: 'Bonifico per il reso del tuo ordine',
  code: 'MYCITY-REGALO-0001',
  amountEuro: 25,
};
const PIENI = {
  ...ESSENZIALI,
  name: 'Giulia Bianchi',
  sellerName: 'Pane Quotidiano',
  storeAddress: 'Via Roma 1, Piacenza',
  pickupCode: '4821',
  motivo: 'requested_by_customer',
  reason: 'requested_by_customer',
  creditoRestituitoEuro: 5,
  creditoEuro: 5,
  bonificoEuro: 5,
  senderName: 'Marco',
  recipientName: 'Anna',
  message: 'Buon compleanno',
};
const VARIANTI: Array<Record<string, unknown>> = [
  ...(['carta', 'credito', 'bonifico', 'misto'] as const).map((modo) => ({ ...PIENI, modo })),
  ESSENZIALI,
];
const DATI_DELLA_CODA = {
  name: 'Giulia Bianchi',
  orderId: ORDINE,
  pickupInStore: false,
  storeName: 'Pane Quotidiano',
  storeAddress: 'Via Roma 1, Piacenza',
  pickupCode: '4821',
  totalEuro: 24.5,
  cartItems: [{ name: 'Pane di grano duro', quantity: 2 }],
};

/** Ogni modello di email che il file esporta, letto per intero (oggetto, HTML, testo semplice). */
function tuttaLaPosta(): Array<{ chi: string; testo: string }> {
  const letti: Array<{ chi: string; testo: string }> = [];
  for (const [nome, valore] of Object.entries(modelli)) {
    if (typeof valore !== 'function' || !/Template$/.test(nome)) continue;
    VARIANTI.forEach((argomenti, i) => {
      const esito = (valore as (a: unknown) => unknown)(argomenti);
      letti.push({ chi: `${nome}#${i}`, testo: JSON.stringify(esito) });
    });
  }
  for (const nome of modelli.NOMI_TEMPLATE_CICLO_DI_VITA) {
    for (const [etichetta, dati] of [['vuoti', {}], ['pieni', DATI_DELLA_CODA]] as const) {
      const m = modelli.preparaEmailCicloDiVita(nome, dati);
      letti.push({ chi: `${nome}#${etichetta}`, testo: m ? `${m.subject} ${m.html} ${m.text}` : '' });
    }
  }
  return letti;
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.example');
});
afterEach(() => {
  interruttore.ritiroAttivo = false;
  vi.unstubAllEnvs();
});

describe('ritiro in negozio spento: la posta non lo promette', () => {
  it('Giulia si e iscritta due giorni fa: la guida «3 cose da sapere» non le parla di ritiro', () => {
    interruttore.ritiroAttivo = false;
    const m = modelli.preparaEmailCicloDiVita('tutorial_day2', {});
    expect(m).not.toBeNull();
    expect(`${m!.subject} ${m!.html} ${m!.text}`).not.toMatch(/ritir/i);
    // Le tre cose da sapere restano tre: come si paga, come arriva la spesa, dove si segue l'ordine.
    for (const parte of [m!.html, m!.text]) {
      expect(parte).toMatch(/alla consegna/);
      expect(parte).toMatch(/portiamo a casa/);
      expect(parte).toMatch(/I miei ordini/);
    }
  });

  it('nessun modello di email del file, di servizio o commerciale, nomina il ritiro', () => {
    interruttore.ritiroAttivo = false;
    const letti = tuttaLaPosta();
    // Il controllo ha letto davvero tutti i modelli, non un elenco vuoto.
    expect(letti.map((l) => l.chi.split('#')[0])).toEqual(
      expect.arrayContaining([
        'orderConfirmedBuyerTemplate',
        'newOrderSellerTemplate',
        'orderReadyTemplate',
        'orderDeliveredTemplate',
        'ordineAnnullatoTemplate',
        'refundIssuedTemplate',
        'bonificoDaFareTemplate',
        'giftCardRecipientTemplate',
        'giftCardBuyerTemplate',
        'welcome',
        'tutorial_day2',
        'first_order_promo',
        'order_ready',
        'order_delivered',
        'abandoned_cart_4h',
      ]),
    );
    const chiNomina = letti.filter((l) => /ritir/i.test(l.testo)).map((l) => l.chi);
    expect(chiNomina).toEqual([]);
  });
});

describe('ritiro in negozio acceso: la guida lo dice, senza condizioni che nessun negozio puo scegliere', () => {
  it('Giulia legge che puo ritirare in negozio, nell HTML e nel testo semplice', () => {
    interruttore.ritiroAttivo = true;
    const m = modelli.preparaEmailCicloDiVita('tutorial_day2', {});
    expect(m).not.toBeNull();
    expect(m!.html).toMatch(/la ritiri tu in negozio/);
    expect(m!.text).toMatch(/la ritiri tu in negozio/);
    expect(`${m!.subject} ${m!.html} ${m!.text}`).not.toMatch(/se il negozio lo permette/i);
  });
});
