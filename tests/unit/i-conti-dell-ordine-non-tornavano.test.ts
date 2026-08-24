/**
 * I conti dell'ordine non tornavano, e la pagina diceva di pagare due volte.
 *
 * Il riepilogo dell'ordine mostrava tre righe — Subtotale, Spedizione, Totale — e il totale non era
 * la somma delle prime due. Le voci che mancavano erano scritte sulla riga d'ordine e non le leggeva
 * nessuno: la consegna MyCity, lo sconto del codice, il credito usato. Il caso tipico: «20,00 +
 * 4,90» in colonna e «27,90» come totale. Tre euro comparsi dal nulla, nella schermata che serve a
 * fidarsi — e su un ordine in contanti è la cifra che si conta in mano al rider.
 *
 * Nella stessa schermata, un riquadro verde senza nessuna condizione: «Paghi X in contanti al rider
 * alla consegna». Usciva su OGNI ordine. Chi aveva appena pagato con la carta leggeva che avrebbe
 * dovuto pagare di nuovo. Il metodo di pagamento non veniva nemmeno letto dal database.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inCentesimi, riepilogoOrdine, statoPagamento } from '@/lib/ordini/riepilogo-ordine';

const ordineBase = {
  total_price: 27.9,
  shipping_cost: 4.9,
  delivery_fee_cents: 300,
  discount_amount: 0,
  wallet_applied_cents: 0,
};

describe('il riepilogo mostra tutto quello che fa il totale', () => {
  it('il caso vero: i tre euro di consegna adesso hanno la loro riga', () => {
    const r = riepilogoOrdine(ordineBase, 2000);
    expect(r.voci.map((v) => v.etichetta)).toEqual(['Subtotale', 'Spedizione', 'Consegna MyCity']);
    expect(r.torna).toBe(true);
    expect(r.sommaCentesimi).toBe(2790);
  });

  it('sconto e credito escono come voci in meno', () => {
    const r = riepilogoOrdine({ ...ordineBase, total_price: 20.9, discount_amount: 2, wallet_applied_cents: 500 }, 2000);
    const sconto = r.voci.find((v) => v.etichetta === 'Sconto codice');
    const credito = r.voci.find((v) => v.etichetta === 'Credito MyCity');
    expect(sconto).toEqual({ etichetta: 'Sconto codice', centesimi: 200, segno: 'meno' });
    expect(credito).toEqual({ etichetta: 'Credito MyCity', centesimi: 500, segno: 'meno' });
    expect(r.torna).toBe(true);
  });

  it('le voci a zero non allungano la colonna', () => {
    const r = riepilogoOrdine({ total_price: 20, shipping_cost: 0, delivery_fee_cents: 0, discount_amount: 0, wallet_applied_cents: 0 }, 2000);
    expect(r.voci.map((v) => v.etichetta)).toEqual(['Subtotale', 'Spedizione']);
    expect(r.torna).toBe(true);
  });

  it('quando NON torna lo dice, con la differenza', () => {
    // È la riga che vale più di tutte: delle voci che non fanno il totale sono peggio di poche
    // voci, perché è una tabella che si contraddice da sola sotto gli occhi di chi ha pagato.
    const r = riepilogoOrdine({ ...ordineBase, total_price: 30 }, 2000);
    expect(r.torna).toBe(false);
    expect(r.differenzaCentesimi).toBe(-210);
  });

  it('gli euro con la virgola diventano centesimi interi, senza code decimali', () => {
    // 0,1 + 0,2 in virgola mobile non fa 0,3: qui si converte una volta sola, all'ingresso.
    expect(inCentesimi(4.9)).toBe(490);
    expect(inCentesimi(0.1 + 0.2)).toBe(30);
    expect(inCentesimi(null)).toBe(0);
    expect(inCentesimi(undefined)).toBe(0);
  });

  it('una colonna assente vale zero, non fa esplodere il conto', () => {
    const r = riepilogoOrdine({ total_price: 24.9, shipping_cost: 4.9 }, 2000);
    expect(r.torna).toBe(true);
  });
});

describe('cosa dire sul pagamento', () => {
  it('contanti non ancora pagati: si dice quanto contare al rider', () => {
    expect(statoPagamento({ payment_method: 'cod', payment_status: 'PENDING' }, 2790))
      .toEqual({ tipo: 'contanti-da-pagare', centesimi: 2790 });
  });

  it('carta già pagata: NON si dice di pagare di nuovo', () => {
    // È il difetto. Il riquadro usciva senza condizione, e chi aveva appena pagato leggeva che
    // avrebbe dovuto pagare di nuovo in contanti.
    const s = statoPagamento({ payment_method: 'card', payment_status: 'PAID' }, 2790);
    expect(s.tipo).toBe('gia-pagato-con-carta');
  });

  it('rimborsato: né l uno né l altro', () => {
    expect(statoPagamento({ payment_method: 'card', payment_status: 'REFUNDED' }, 2790)).toEqual({ tipo: 'rimborsato' });
    expect(statoPagamento({ payment_method: 'cod', payment_status: 'REFUNDED' }, 2790)).toEqual({ tipo: 'rimborsato' });
  });

  it('se non so come è stato pagato, non dico niente', () => {
    // Un ordine vecchio può non avere il metodo scritto. Meglio un riquadro in meno di un riquadro
    // che sbaglia sui soldi.
    expect(statoPagamento({}, 2790)).toEqual({ tipo: 'non-lo-so' });
    expect(statoPagamento({ payment_method: null, payment_status: 'PENDING' }, 2790)).toEqual({ tipo: 'non-lo-so' });
  });

  it('contanti già pagati non chiedono di pagare ancora', () => {
    expect(statoPagamento({ payment_method: 'cod', payment_status: 'PAID' }, 2790).tipo).toBe('non-lo-so');
  });
});

describe("l'invariante di STRUTTURA sulla pagina dell'ordine", () => {
  const src = readFileSync(join(process.cwd(), 'app/orders/[id]/page.tsx'), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('la pagina legge davvero le quattro colonne che fanno il totale', () => {
    for (const colonna of ['delivery_fee_cents', 'discount_amount', 'wallet_applied_cents', 'payment_method']) {
      expect(src, `la pagina non legge ${colonna}`).toContain(colonna);
    }
  });

  it('il riquadro dei contanti non è più senza condizione', () => {
    expect(src).toMatch(/pagamento\.tipo === 'contanti-da-pagare'/);
  });

  it('il riepilogo non è più scritto a mano riga per riga', () => {
    // Le tre righe fisse erano il difetto: una colonna scritta a mano non può accorgersi di una
    // voce nuova sulla riga d'ordine.
    expect(src).toMatch(/riepilogo\.voci\.map\(/);
  });
});

describe('la stessa regola sul riepilogo che vede il negoziante', () => {
  // Il difetto era su tutt'e due le pagine, e curarne una sola avrebbe lasciato il negoziante a
  // leggere un totale che non torna — cioè la cifra che deve incassare.
  const src = readFileSync(join(process.cwd(), 'app/seller/orders/[id]/page.tsx'), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('passa dalla stessa funzione del riepilogo del cliente', () => {
    expect(src).toMatch(/riepilogoOrdine\(/);
    expect(src).toMatch(/riepilogo\.voci\.map\(/);
  });

  it('chiede al database le tre voci che compongono il totale', () => {
    for (const colonna of ['delivery_fee_cents', 'discount_amount', 'wallet_applied_cents']) {
      expect(src, `la pagina del negoziante non legge ${colonna}`).toContain(colonna);
    }
  });

  it('se le voci non fanno il totale, lo dichiara', () => {
    expect(src).toMatch(/!riepilogo\.torna/);
  });
});
