import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ingressiDellaCassa, riepilogoDaMostrare, type StatoDellaCassa } from '@/lib/ordini/riepilogo-cassa';
import { prezziDelCarrello } from '@/lib/ordini/prezzi';

/**
 * 26/11/2026 (R26-005) — LA CASSA PASSA AL CONTO QUELLO CHE IL CLIENTE HA SCELTO.
 *
 * Le prove del conto (`lo-schermo-e-il-server-fanno-lo-stesso-conto`, `in-cassa-il-totale-…`)
 * chiamano `riepilogoDaMostrare` con ingressi scritti da loro. Quello che la PAGINA gli passava
 * non lo guardava nessuno: con `couponScontoCents: 0` scritto nella cassa restavano verdi 497
 * prove, mentre un codice da 5 € su 24,50 € faceva leggere 27,50 € a schermo e il server ne
 * addebitava 22,50.
 *
 * Qui: ① gli ingressi nascono dallo stato della cassa (`ingressiDellaCassa`) e si confrontano col
 * conto che fa il server con gli stessi dati (sottototali riga per riga, codice, consegna, credito
 * solo coi contanti); ② la pagina passa il suo stato così com'è, coi suoi nomi, e al conto non
 * aggiunge né riscrive niente (letto sull'albero del codice, non come parola).
 */

const PANE = 'negozio-pane';
const FRUTTA = 'negozio-frutta';

/** Lo stato della cassa di partenza: 24,50 € di merce in due negozi, contanti, niente codice. */
function stato(cambi: Partial<StatoDellaCassa> = {}): StatoDellaCassa {
  return {
    groups: [
      { sellerId: PANE, storeLat: 45.05, storeLng: 9.69, items: [{ price: 3.5, quantity: 3 }, { price: 4, quantity: 1 }] },
      { sellerId: FRUTTA, storeLat: null, storeLng: null, items: [{ price: 1.1, quantity: 5 }, { price: 4.5, quantity: 1 }] },
    ],
    form: { lat: 45.04, lng: 9.7 },
    pickupInStore: false,
    appliedCoupon: null,
    usaCredito: true,
    walletCents: 0,
    ...cambi,
  };
}

/** Il conto che fa il server con gli stessi dati (le due rotte: sottototali in centesimi riga per riga). */
function contoDelServer(s: StatoDellaCassa, consegnaVeloce = false) {
  const prezzi = prezziDelCarrello({
    gruppi: s.groups.map((g) => ({
      sellerId: g.sellerId,
      subtotalCents: g.items.reduce((t, it) => t + Math.round(it.price * 100) * it.quantity, 0),
    })),
    coordinateNegozio: (id) => {
      const g = s.groups.find((x) => x.sellerId === id);
      return { lat: g?.storeLat ?? null, lng: g?.storeLng ?? null };
    },
    consegnaLat: s.form.lat,
    consegnaLng: s.form.lng,
    pickupInStore: s.pickupInStore,
    couponSpedizioneGratis: s.appliedCoupon?.freeShipping ?? false,
    couponScontoCents: Math.round((s.appliedCoupon?.discount ?? 0) * 100),
    consegnaVeloce,
  });
  // La rotta dei contanti scala il credito (wallet_debit) fino al lordo, e solo se chiesto.
  const credito = s.usaCredito ? Math.min(s.walletCents ?? 0, prezzi.grandTotalCents) : 0;
  return { prezzi, credito, daPagareCents: prezzi.grandTotalCents - credito };
}

const schermo = (s: StatoDellaCassa, consegnaVeloce = false) => riepilogoDaMostrare({ ...ingressiDellaCassa(s), consegnaVeloce });
const cents = (euro: number) => Math.round(euro * 100);

describe('① gli ingressi del conto nascono dallo stato della cassa', () => {
  it('la merce è quella del carrello: 24,50 € in due negozi, riga per riga in centesimi', () => {
    const i = ingressiDellaCassa(stato());
    expect(i.gruppi).toEqual([
      { sellerId: PANE, subtotalCents: 1450 },
      { sellerId: FRUTTA, subtotalCents: 1000 },
    ]);
    expect(schermo(stato()).subtotale).toBe(24.5);
  });

  it('un prezzo scontato col mezzo centesimo (3,50 € meno 15% = 2,975 €) si arrotonda riga per riga, come il server', () => {
    const s = stato({ groups: [{ sellerId: PANE, storeLat: null, storeLng: null, items: [{ price: 2.975, quantity: 2 }] }] });
    expect(ingressiDellaCassa(s).gruppi[0].subtotalCents).toBe(Math.round(2.975 * 100) * 2);
    expect(cents(schermo(s).totale)).toBe(contoDelServer(s).daPagareCents);
  });

  it('un codice da 5 € su 24,50 €: lo schermo dice quello che il server addebita, non 5 € di più', () => {
    const s = stato({ appliedCoupon: { discount: 5, freeShipping: false } });
    const senzaCodice = schermo(stato());
    const r = schermo(s);
    const server = contoDelServer(s);
    expect(server.prezzi.scontoApplicatoCents, 'il caso deve avere uno sconto vero').toBe(500);
    expect(cents(r.scontoCodice), 'lo sconto del codice non arriva al conto della cassa').toBe(500);
    expect(cents(r.totale), 'lo schermo mostra un totale diverso da quello addebitato').toBe(server.daPagareCents);
    expect(cents(senzaCodice.totale) - cents(r.totale), 'il codice cambia lo schermo quanto cambia l addebito').toBe(
      contoDelServer(stato()).daPagareCents - server.daPagareCents,
    );
    expect(cents(r.totale)).toBeLessThan(cents(senzaCodice.totale));
  });

  it('il codice «Spedizione gratuita» arriva al conto: la consegna è quella che il server fa pagare', () => {
    const s = stato({ appliedCoupon: { discount: 0, freeShipping: true } });
    const r = schermo(s);
    const server = contoDelServer(s);
    const consegnaServer = server.prezzi.gruppi.reduce((t, g) => t + g.deliveryFeeCents, 0);
    expect(consegnaServer, 'il caso deve avere una consegna tolta dal codice').toBeLessThan(
      contoDelServer(stato()).prezzi.gruppi.reduce((t, g) => t + g.deliveryFeeCents, 0),
    );
    expect(cents(r.feeConsegna), 'la consegna a schermo non vede il codice «Spedizione gratuita»').toBe(consegnaServer);
    expect(cents(r.totale)).toBe(server.daPagareCents);
    expect(r.consegnaSenzaCodice, 'la riga del codice deve poter dire quanto copre').toBeGreaterThan(r.feeConsegna);
  });

  it('il credito della persona arriva al conto quando entra, e fino al lordo', () => {
    const contanti = stato({ walletCents: 1000 });
    const r = schermo(contanti);
    expect(cents(r.creditoUsato), 'il credito della persona non arriva al conto').toBe(1000);
    expect(cents(r.totale)).toBe(contoDelServer(contanti).daPagareCents);

    const senza = stato({ walletCents: 1000, usaCredito: false });
    expect(schermo(senza).creditoUsato, 'il credito entra anche quando non deve').toBe(0);
    expect(cents(schermo(senza).totale)).toBe(contoDelServer(senza).daPagareCents);

    const tanto = stato({ walletCents: 999_00 });
    expect(cents(schermo(tanto).creditoUsato)).toBe(contoDelServer(tanto).prezzi.grandTotalCents);
    expect(schermo(tanto).totale).toBe(0);

    expect(schermo(stato({ walletCents: undefined })).creditoUsato, 'credito non ancora letto = zero').toBe(0);
  });

  it('il ritiro in negozio e la veloce arrivano al conto come al server', () => {
    const ritiro = stato({ pickupInStore: true });
    expect(cents(schermo(ritiro).totale)).toBe(contoDelServer(ritiro).daPagareCents);
    expect(schermo(ritiro).feeConsegna, 'col ritiro non si paga la consegna').toBe(0);
    expect(cents(schermo(stato(), true).totale)).toBe(contoDelServer(stato(), true).daPagareCents);
  });

  it('le coordinate sono quelle del negozio e dell indirizzo scelto, non null scritte a mano', () => {
    const i = ingressiDellaCassa(stato());
    expect(i.coordinateNegozio(PANE)).toEqual({ lat: 45.05, lng: 9.69 });
    expect(i.coordinateNegozio(FRUTTA)).toEqual({ lat: null, lng: null });
    expect([i.consegnaLat, i.consegnaLng]).toEqual([45.04, 9.7]);
  });
});

/**
 * ② La pagina, letta col compilatore TypeScript: la chiamata a `ingressiDellaCassa` porta lo stato
 * della cassa con i suoi nomi (proprietà brevi, `{ appliedCoupon }`: nessun `appliedCoupon: null`),
 * più la regola del credito scritta accanto alla scelta del pagamento (solo coi contanti, se
 * spuntato); la chiamata a `riepilogoDaMostrare` ci aggiunge solo la consegna veloce (nessun
 * `couponScontoCents: 0` scritto dopo, che vincerebbe sul valore vero).
 */
const PAGINA = readFileSync(join(process.cwd(), 'app/checkout/page.tsx'), 'utf8');

function chiamate(nome: string): ts.CallExpression[] {
  const sorgente = ts.createSourceFile('page.tsx', PAGINA, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const trovate: ts.CallExpression[] = [];
  const visita = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === nome) trovate.push(n);
    ts.forEachChild(n, visita);
  };
  visita(sorgente);
  return trovate;
}

const nomeDi = (p: ts.ObjectLiteralElementLike) =>
  ts.isSpreadAssignment(p) ? `...${p.expression.getText()}` : p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : p.getText();

describe('② la pagina passa al conto il suo stato, senza riscriverlo', () => {
  it('ingressiDellaCassa riceve lo stato della cassa con i suoi nomi, tutto e senza valori scritti a mano', () => {
    const [c, ...altre] = chiamate('ingressiDellaCassa');
    expect(c, 'la cassa non passa più da ingressiDellaCassa: questa prova non misurerebbe niente').toBeDefined();
    expect(altre, 'una sola chiamata').toEqual([]);
    const arg = c.arguments[0];
    expect(arg && ts.isObjectLiteralExpression(arg), 'lo stato si passa come oggetto scritto lì').toBe(true);
    const props = (arg as ts.ObjectLiteralExpression).properties;
    const riscritti = props
      .filter((p) => !ts.isShorthandPropertyAssignment(p) && nomeDi(p) !== 'usaCredito')
      .map((p) => p.getText());
    expect(riscritti, 'un valore dello stato è stato riscritto a mano invece di passare quello della cassa').toEqual([]);
    expect(props.map(nomeDi).sort()).toEqual(
      ['appliedCoupon', 'form', 'groups', 'pickupInStore', 'usaCredito', 'walletCents'].sort(),
    );
    const credito = props.find((p) => nomeDi(p) === 'usaCredito') as ts.PropertyAssignment;
    expect(
      credito.initializer.getText().replace(/\s+/g, ' '),
      'il credito entra solo negli ordini in contanti, e solo se spuntato (la carta passa da Stripe)',
    ).toBe("paymentMethod === 'cod' && useCredit");
  });

  it('riepilogoDaMostrare riceve quegli ingressi e in più solo la veloce, ricavata dalla fascia', () => {
    const conto = chiamate('riepilogoDaMostrare');
    expect(conto, 'la cassa deve fare il conto una volta sola').toHaveLength(1);
    const arg = conto[0].arguments[0];
    expect(arg && ts.isObjectLiteralExpression(arg)).toBe(true);
    const props = (arg as ts.ObjectLiteralExpression).properties;
    // Il nome della variabile che tiene gli ingressi: quella assegnata da ingressiDellaCassa(…).
    const dichiarazione = chiamate('ingressiDellaCassa')[0]?.parent;
    expect(dichiarazione && ts.isVariableDeclaration(dichiarazione) && ts.isIdentifier(dichiarazione.name)).toBe(true);
    const ingressi = ((dichiarazione as ts.VariableDeclaration).name as ts.Identifier).text;
    expect(props.map(nomeDi), 'al conto si aggiunge o si riscrive qualcosa oltre agli ingressi della cassa').toEqual([
      `...${ingressi}`,
      'consegnaVeloce',
    ]);
    const veloce = props[1] as ts.PropertyAssignment;
    expect(veloce.initializer.getText().replace(/\s+/g, ' ')).toBe(
      'eConsegnaVeloce({ fascia: deliverySlot, ritiroInNegozio: pickupInStore })',
    );
  });
});
