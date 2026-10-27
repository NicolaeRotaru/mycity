import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrderSummary } from '@/components/checkout/OrderSummary';
import { PLATFORM_DELIVERY_FEE_CENTS } from '@/lib/constants';
import { formatPrice } from '@/lib/format';
import { cifraDellaVoce, riepilogoOrdine, type OrdinePerRiepilogo } from '@/lib/ordini/riepilogo-ordine';
import { promessaSpedizione, VOCE_CONSEGNA } from '@/lib/promesse-pubbliche';

/**
 * 27/10/2026 (terzo giro) — LA CONSEGNA DA 3 EURO: UN NOME SOLO, E MAI «GRATIS» SOPRA DI LEI.
 *
 * Dal 27/10 la spedizione è zero su ogni ordine e il cliente paga solo i 3 euro di consegna per
 * negozio (scelta 8 della carta #209). Le schermate però erano rimaste a prima:
 *  · la pagina dell'ordine, del cliente e del negozio, scriveva «Spedizione GRATUITA» e subito sotto
 *    «Consegna MyCity 3,00 €», su OGNI ordine: la riga della spedizione a zero diceva «gratis» senza
 *    guardare la consegna;
 *  · il riepilogo della cassa chiamava i 3 euro «Spedizione», il carrello «Consegna MyCity»; e se
 *    riceveva le due cifre separate scriveva ancora «Spedizione Gratis» sopra i 3 euro;
 *  · la scheda prodotto diceva la consegna due volte, con due nomi: si può leggere come 6 euro.
 *
 * Qui si prova quello che la persona legge: le righe come le scrive la pagina dell'ordine (con la
 * stessa funzione che la pagina chiama), e il riepilogo della cassa trasformato in HTML.
 */

const TRE_EURO = formatPrice(PLATFORM_DELIVERY_FEE_CENTS / 100);
const euro = (centesimi: number) => formatPrice(centesimi / 100);
const sorgente = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const GRATIS = /gratis|gratuit/i;
/** Il riepilogo della cassa con 20 euro di spesa e una consegna, riletto il 27/10: 23 euro, niente regali. */
const RIEPILOGO_RILETTO =
  `Subtotale ${euro(2000)} ${VOCE_CONSEGNA} ${TRE_EURO} Totale ${euro(2300)} ` +
  `Ordina e paga alla consegna · ${euro(2300)} Non paghi adesso. Paghi in contanti al rider quando arriva. ` +
  'Reso entro 14 giorni Venditore locale';

/** Le righe della colonna come le scrive la pagina dell'ordine: «etichetta cifra». */
function righeDellaPagina(ordine: OrdinePerRiepilogo, subtotaleCentesimi: number): string[] {
  return riepilogoOrdine(ordine, subtotaleCentesimi).voci.map((v) => `${v.etichetta} ${cifraDellaVoce(v, euro)}`);
}

/** Il testo di un pezzo di HTML, con le entità sciolte. */
function testoDi(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t\r\n]+/g, ' ')
    .trim();
}

describe('dopo il pagamento la pagina dell’ordine non scrive «gratis» sopra la consegna', () => {
  it('IL CASO DI OGNI ORDINE — spedizione 0 e consegna 3 euro: nessun «GRATUITA», e la consegna col suo nome', () => {
    const ordine: OrdinePerRiepilogo = {
      total_price: 23,
      shipping_cost: 0,
      delivery_fee_cents: PLATFORM_DELIVERY_FEE_CENTS,
      discount_amount: 0,
      wallet_applied_cents: 0,
    };
    const righe = righeDellaPagina(ordine, 2000);
    expect(righe.filter((r) => GRATIS.test(r)), `la pagina dell'ordine scrive: ${righe.join(' · ')}`).toEqual([]);
    expect(righe).toContain(`${VOCE_CONSEGNA} ${TRE_EURO}`);
    expect(riepilogoOrdine(ordine, 2000).torna, 'le voci devono fare ancora il totale').toBe(true);
  });

  it('«GRATUITA» solo se per portarsi a casa la spesa il cliente non ha pagato niente', () => {
    const righe = righeDellaPagina({ total_price: 20, shipping_cost: 0, delivery_fee_cents: 0 }, 2000);
    expect(righe).toContain('Spedizione GRATUITA');
  });

  it('un ordine di prima del 27/10, con la spedizione pagata, la mostra ancora accanto alla consegna', () => {
    const righe = righeDellaPagina({ total_price: 27.9, shipping_cost: 4.9, delivery_fee_cents: 300 }, 2000);
    expect(righe).toEqual([`Subtotale ${euro(2000)}`, `Spedizione ${euro(490)}`, `${VOCE_CONSEGNA} ${TRE_EURO}`]);
  });

  it('le due pagine (cliente e negozio) scrivono la cifra con la funzione del riepilogo, e non decidono «GRATUITA» da sole', () => {
    for (const p of ['app/orders/[id]/page.tsx', 'app/seller/orders/[id]/page.tsx']) {
      const s = sorgente(p);
      expect(s, `${p} non scrive la colonna con cifraDellaVoce`).toMatch(/riepilogo\.voci\.map\([\s\S]{0,400}?cifraDellaVoce\(v,/);
      expect(s, `${p} decide da sola quando scrivere «GRATUITA»`).not.toMatch(/GRATUIT/);
      // 27/10 (quarto giro): il controllo qui sopra guardava solo il maiuscolo, e «Gratis», «gratuita»,
      // «inclusa» o «offerta» scritte dalla pagina passavano. Nel codice senza commenti la pagina non
      // scrive da sola nessuna parola che regala la consegna: quella la decide il riepilogo.
      const codice = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const regali = codice.match(/gratis|gratuit|omaggi|inclus[ao]|offert[ao]|a carico nostro|costo zero|nessun costo/gi) ?? [];
      expect(regali, `${p} scrive da sola che la consegna non si paga`).toEqual([]);
    }
  });
});

describe('la cassa chiama la consegna come il carrello, e scrive «Gratis» solo se non si paga niente', () => {
  const fissi = {
    subtotal: 20,
    pickupDiscount: 0,
    couponDiscount: 0,
    total: 23,
    isCheckingOut: false,
    paymentMethod: 'cod' as const,
  };
  const riepilogo = (p: { shipping: number; platformDeliveryFee?: number; paymentMethod?: 'cod' | 'card' }) =>
    testoDi(renderToStaticMarkup(<OrderSummary {...fissi} {...p} />));

  it('spedizione e consegna passate separate: niente «Spedizione Gratis» sopra i 3 euro', () => {
    const t = riepilogo({ shipping: 0, platformDeliveryFee: PLATFORM_DELIVERY_FEE_CENTS / 100 });
    expect(t, t).not.toMatch(GRATIS);
    expect(t).toContain(`${VOCE_CONSEGNA} ${TRE_EURO}`);
  });

  it('la cifra già sommata, come la passa la cassa: la riga si chiama come nel carrello', () => {
    const t = riepilogo({ shipping: PLATFORM_DELIVERY_FEE_CENTS / 100 });
    expect(t).toContain(`${VOCE_CONSEGNA} ${TRE_EURO}`);
    expect(t, 'il riepilogo della cassa chiama ancora «Spedizione» i 3 euro di consegna').not.toMatch(/Spedizione/);
  });

  it('«Gratis» resta solo quando le due cifre insieme fanno zero', () => {
    expect(riepilogo({ shipping: 0, platformDeliveryFee: 0 })).toMatch(/Gratis/);
  });

  /**
   * 27/10/2026 (quinto giro) — IL COLLAUDO HA CAMBIATO PAROLA. Con la spedizione a zero e i 3 euro
   * passati a parte, il riepilogo scriveva «Consegna MyCity 3,00 € · spedizione in omaggio»: niente
   * «gratis», quindi la prova qui sopra restava verde. Un regalo scritto sopra una consegna che si
   * paga. Qui non si cercano parole: le due strade con cui arrivano gli stessi 3 euro devono dire le
   * stesse identiche cose, e quelle cose sono il testo riletto contro la cassa il 27/10.
   */
  it('IL CASO DEL COLLAUDO — i 3 euro passati a parte o già sommati dicono le stesse parole, quelle rilette', () => {
    const tre = PLATFORM_DELIVERY_FEE_CENTS / 100;
    const aParte = riepilogo({ shipping: 0, platformDeliveryFee: tre });
    expect(aParte, 'con i 3 euro passati a parte il riepilogo dice cose in più').toBe(riepilogo({ shipping: tre }));
    expect(aParte).toBe(riepilogo({ shipping: tre, platformDeliveryFee: 0 }));
    expect(aParte, 'il riepilogo della cassa è cambiato: rileggilo contro la cassa').toBe(RIEPILOGO_RILETTO);
    // Con la carta cambiano le parole sul pagamento, non quelle sulla consegna.
    expect(riepilogo({ shipping: 0, platformDeliveryFee: tre, paymentMethod: 'card' })).toBe(
      riepilogo({ shipping: tre, paymentMethod: 'card' }),
    );
  });

  it('il carrello prende il nome della voce dalla stessa costante', () => {
    const carrello = sorgente('app/cart/page.tsx');
    expect(carrello).toMatch(/\{VOCE_CONSEGNA\}/);
    expect(carrello, 'nel carrello il nome della consegna è tornato scritto a mano').not.toMatch(/^\s*Consegna MyCity\s*$/m);
  });
});

describe('la scheda prodotto dice la consegna una volta, col nome di carrello e cassa', () => {
  it('le frasi della vetrina sulla consegna usano lo stesso nome della voce', () => {
    const p = promessaSpedizione();
    expect(p.titolo.startsWith(`${VOCE_CONSEGNA} ${TRE_EURO}`), p.titolo).toBe(true);
    expect(String(p.dettaglioConsegna).startsWith(`${VOCE_CONSEGNA} ${TRE_EURO}`), String(p.dettaglioConsegna)).toBe(true);
  });

  it('sotto il riquadro della consegna non torna una seconda riga con la stessa cifra', () => {
    const scheda = sorgente('app/product/[id]/page.tsx');
    expect(scheda, 'la riga di FreeShippingProgress ripete la consegna sotto il riquadro').not.toMatch(/<FreeShippingProgress\b/);
    const frasi = [...scheda.matchAll(/\{spedizione\.dettaglioConsegna\}/g)];
    expect(frasi, 'la frase del costo di consegna compare più di una volta').toHaveLength(1);
  });
});
