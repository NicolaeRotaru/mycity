import { describe, it, expect, vi } from 'vitest';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

// La campanella al negozio vive nei pezzi condivisi del webhook Stripe: per
// chiamarla qui bastano due finti, perche' il client del database glielo si
// passa come argomento (e sotto gliene diamo uno che si limita a registrare).
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => ({}) }));
import {
  orderConfirmedBuyerTemplate,
  newOrderSellerTemplate,
  refundIssuedTemplate,
} from '@/lib/email/templates';
import { buildShippingLabel } from '@/lib/shipping-etichetta/label';
import { suonaLaCampanellaAiNegozi } from '@/lib/stripe/webhook/comune';

/**
 * 6/9/2026 — LO STESSO ORDINE DICEVA DUE CIFRE DIVERSE A DUE PERSONE DIVERSE.
 *
 * Passo indietro: di un ordine la cifra da pagare non si scrive in un posto
 * solo. Esce dall'email che arriva al cliente, dall'email che arriva al
 * negoziante, dall'email del rimborso, e dal foglio che il fattorino stampa e
 * si porta dietro. Sono quattro canali, ma e' UN ordine.
 *
 * Cos'era successo. `formatPrice` e' passata all'italiano — «35,00 €» — mentre
 * i canali che si ricostruivano la cifra a mano con `toFixed(2)` sono rimasti
 * all'inglese: «€35.00». Prima erano tutti sbagliati allo stesso modo, e almeno
 * si somigliavano; dopo si contraddicevano. Il negoziante leggeva «35,00 €» e
 * il fattorino, sullo stesso ordine, «€35.00».
 *
 * Detto con altre parole: questa prova non guarda se una cifra e' scritta
 * BENE. Guarda se i canali sono D'ACCORDO. Per questo non c'e' nessuna stringa
 * attesa scritta qui dentro: si fa girare ogni canale davvero, si raccoglie la
 * cifra che ognuno ha scritto, e si pretende che siano tutte la stessa. Il
 * giorno in cui qualcuno rimette `€${(cents / 100).toFixed(2)}` da una parte
 * sola, qui diventa rosso e dice quale canale si e' staccato dagli altri.
 */

/** Gli importi di prova, in centesimi. Il primo e' il caso vero del 6/9. */
const IMPORTI_IN_CENTESIMI = [
  3500,   // 35,00 € — l'ordine che arrivava «35,00 €» via email e «€35.00» sull'etichetta
  123450,  // 1234,50 € — quattro cifre: l'italiano qui NON mette il punto
  1234567, // 12.345,67 € — da cinque cifre in su arriva il punto delle migliaia,
           //               ed e' il caso dove l'inglese «€12345.67» confonde di piu'
  990,    // 9,90 €
  5,      // 0,05 € — il centesimo singolo
];

/**
 * Ogni cifra di soldi che compare in un testo, nella forma esatta in cui e'
 * scritta. Prende sia l'italiano («35,00 €») sia l'inglese («€35.00»), perche'
 * il senso della prova e' proprio farli scontrare. Niente viene normalizzato:
 * due modi diversi devono restare due stringhe diverse.
 */
function cifreDiSoldi(testo: string): string[] {
  return [...testo.matchAll(/€[  ]?[\d.,]+|[\d.,]+[  ]?€/g)].map((m) => m[0]);
}

/** Sgonfia i flussi compressi del PDF: PDFKit non scrive il testo in chiaro. */
function flussiDelPdf(pdf: Buffer): string {
  let flusso = '';
  let da = 0;
  for (;;) {
    const inizio = pdf.indexOf('stream', da);
    if (inizio < 0) break;
    let s = inizio + 'stream'.length;
    if (pdf[s] === 0x0d) s++;
    if (pdf[s] === 0x0a) s++;
    const fine = pdf.indexOf('endstream', s);
    if (fine < 0) break;
    try {
      flusso += zlib.inflateSync(pdf.subarray(s, fine)).toString('latin1');
    } catch {
      // flusso non compresso o non di testo: si salta
    }
    da = fine + 1;
  }
  return flusso;
}

/**
 * Le parole davvero stampate sull'etichetta. Nel PDF stanno come gruppi
 * esadecimali, un byte per lettera, nella tabella WinAnsi dei font standard:
 * li' l'euro e' il byte 0x80, e va rimesso al suo posto per poterlo confrontare
 * con quello che scrivono le email.
 */
function paroleStampate(pdf: Buffer): string {
  let testo = '';
  for (const gruppo of flussiDelPdf(pdf).matchAll(/<([0-9a-fA-F]+)>/g)) {
    testo += Buffer.from(gruppo[1], 'hex').toString('latin1');
  }
  return testo.replace(/\x80/g, '€');
}

/** Fa girare ogni canale sullo stesso ordine e riporta cosa ha scritto ciascuno. */
async function cosaScriveOgniCanale(centesimi: number): Promise<Map<string, string[]>> {
  const euro = centesimi / 100;
  const ordine = { orderId: 'a1b2c3d4-0000-0000-0000-000000000000' };

  const etichetta = await buildShippingLabel({
    ...ordine,
    recipientName: 'Mario Rossi',
    street: 'Via Roma 1',
    zip: '29121',
    city: 'Piacenza',
    phone: '+39 333 1234567',
    sellerName: 'Pane Quotidiano',
    totalCents: centesimi,
    isCod: true,
  });

  // La notifica che arriva sul telefono del negoziante. Non la si finge: si
  // chiama la funzione vera, le si passa un client che invece di scrivere sul
  // database tiene da parte le righe, e si legge cosa ha scritto nel testo.
  const righeDiNotifica: Record<string, unknown>[] = [];
  const finotoDatabase = {
    from: () => ({
      insert: (righe: Record<string, unknown>[]) => {
        righeDiNotifica.push(...righe);
        return Promise.resolve({ error: null });
      },
    }),
  };
  await suonaLaCampanellaAiNegozi(
    finotoDatabase as never,
    [{ orderId: ordine.orderId, sellerId: 'negozio-1', totalCents: centesimi, itemsCount: 3 }],
    'checkout-di-prova',
  );

  const daCliente = orderConfirmedBuyerTemplate({ ...ordine, total: euro, storeName: 'Pane Quotidiano' });
  const daNegoziante = newOrderSellerTemplate({ ...ordine, total: euro, itemsCount: 3 });
  const daRimborso = refundIssuedTemplate({ ...ordine, amount: euro });

  return new Map<string, string[]>([
    ["l'email al cliente", cifreDiSoldi(`${daCliente.subject} ${daCliente.html} ${daCliente.text}`)],
    ["l'email al negoziante", cifreDiSoldi(`${daNegoziante.subject} ${daNegoziante.html} ${daNegoziante.text}`)],
    ["l'email del rimborso", cifreDiSoldi(`${daRimborso.subject} ${daRimborso.html} ${daRimborso.text}`)],
    ["l'etichetta che stampa il fattorino", cifreDiSoldi(paroleStampate(etichetta))],
    [
      'la notifica sul telefono del negoziante',
      cifreDiSoldi(righeDiNotifica.map((r) => `${r.title} ${r.body}`).join(' ')),
    ],
  ]);
}

describe('lo stesso ordine dice la stessa cifra su ogni canale', () => {
  for (const centesimi of IMPORTI_IN_CENTESIMI) {
    it(`un ordine da ${centesimi} centesimi: tutti i canali scrivono la cifra allo stesso modo`, async () => {
      const perCanale = await cosaScriveOgniCanale(centesimi);

      // ① Nessun canale puo' cavarsela non scrivendo la cifra: se sparisce,
      //    il confronto qui sotto passerebbe per finta.
      for (const [canale, cifre] of perCanale) {
        expect(cifre.length, `${canale} non scrive nessuna cifra di soldi: o e' sparita, o non e' piu' riconoscibile come denaro`)
          .toBeGreaterThan(0);
      }

      // ② Ogni canale deve essere coerente con se stesso (oggetto, corpo e
      //    testo semplice della stessa email non possono divergere).
      for (const [canale, cifre] of perCanale) {
        expect(new Set(cifre).size, `dentro ${canale} la stessa cifra e' scritta in ${new Set(cifre).size} modi: ${[...new Set(cifre)].map((c) => JSON.stringify(c)).join(' vs ')}`)
          .toBe(1);
      }

      // ③ E i canali devono essere d'accordo fra loro. E' il cuore: se due
      //    scrivono lo stesso importo in due modi, qui si dice QUALI due e
      //    COSA ha scritto ciascuno.
      const scritte = [...perCanale].map(([canale, cifre]) => ({ canale, cifra: cifre[0] }));
      const riferimento = scritte[0];
      const discordi = scritte.filter((s) => s.cifra !== riferimento.cifra);

      expect(
        discordi.map((s) => `${s.canale} scrive ${JSON.stringify(s.cifra)}`),
        `stesso ordine, cifre diverse: ${riferimento.canale} scrive ${JSON.stringify(riferimento.cifra)}, ` +
        `ma ${discordi.map((s) => `${s.canale} scrive ${JSON.stringify(s.cifra)}`).join(' e ')}. ` +
        'Chi diverge si sta ricostruendo l\'importo a mano invece di passare da lib/format.ts.',
      ).toEqual([]);
    });
  }

  /**
   * Due punti scrivono soldi ma non si riescono a far girare da qui.
   *
   * La schermata dove il fattorino dichiara i contanti e' un componente React
   * che si apre solo dopo un clic: per farlo comparire servirebbe una libreria
   * di prova che qui non c'e', e aggiungerla vuol dire toccare package.json.
   * La rotta del contrassegno e' un gestore intero, che per partire chiede una
   * ventina di finti (autenticazione, magazzino, posta, pagamenti).
   *
   * Quindi per questi due si legge il sorgente. Vale MENO delle cinque prove
   * qui sopra, che fanno girare il codice davvero, ed e' giusto saperlo.
   *
   * Cosa sorveglia: che l'euro non torni mai attaccato a mano davanti a un
   * valore calcolato («€{...}» o «€${...}»). L'etichetta fissa di un campo,
   * «Contante da rimettere (€)», resta lecita: li' l'euro non tocca un numero.
   */
  const SORVEGLIATI_A_VISTA = [
    ['la schermata dei contanti del fattorino', 'components/rider/CashConfirmDialog.tsx'],
    ["l'avviso al negozio per un ordine in contrassegno", 'app/api/orders/cod/route.ts'],
  ] as const;

  for (const [chiSi, file] of SORVEGLIATI_A_VISTA) {
    it(`in ${chiSi} l euro non torna attaccato a mano su una cifra calcolata`, () => {
      const sorgente = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
      const aMano = sorgente
        .split('\n')
        .map((riga, i) => ({ n: i + 1, riga }))
        .filter(({ riga }) => !riga.trimStart().startsWith('//') && !riga.trimStart().startsWith('*'))
        .filter(({ riga }) => /€\s*[{$]/.test(riga));

      expect(
        aMano.map(({ n, riga }) => `${file}:${n} — ${riga.trim()}`),
        `in ${file} l'euro e' scritto a mano davanti a una cifra calcolata: chi legge quel canale ` +
        'vedrebbe «€35.00» mentre lo stesso ordine, via email, dice «35,00 €». Si passa da formatPriceFromCents.',
      ).toEqual([]);
    });
  }
});
