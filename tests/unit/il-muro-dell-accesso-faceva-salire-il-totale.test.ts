/**
 * Chi si registrava a metà cassa tornava indietro e il totale era più alto di prima.
 *
 * IL CASO. L'indirizzo si compila da ospiti e l'accesso viene chiesto solo alla fine, al momento di
 * confermare. Per non far perdere il lavoro fatto, la pagina salvava una bozza. Salvava `form` e
 * basta: nome, indirizzo, città, CAP, telefono, note.
 *
 * Restavano fuori **il codice sconto, il metodo di pagamento e la fascia di consegna**. Chi si
 * registrava proprio lì tornava con lo sconto sparito e il pagamento riportato a «carta».
 * **Un totale che sale dopo il login è la definizione del carrello abbandonato**: la persona ha
 * appena dato email e password, torna, e la cifra è più alta di quella che aveva accettato.
 *
 * PERCHÉ SI RIPORTA IL CODICE E NON LO SCONTO. Due motivi che vanno nella stessa direzione.
 * ① La bozza sta nel browser, e nel browser ci scrive chiunque: se il ritorno rimettesse la cifra
 *    salvata, basterebbe aprire `localStorage` per vedersi un carrello scontato.
 * ② Il carrello può essere cambiato nel frattempo, e quello sconto può non essere più suo.
 * Il codice è solo una stringa: passa dalla verifica come il primo giorno.
 *
 * E LA FASCIA HA LA SUA TRAPPOLA: login alle 19:55, ritorno alle 20:05. «Stasera · 18:00–20:00» era
 * giusta e adesso non lo è più. Rimetterla vorrebbe dire riportare la persona sull'ordine con
 * l'appuntamento già passato — il difetto che il lotto prima aveva appena chiuso.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  bozzaDaSalvare,
  bozzaLetta,
  fasciaDaRimettere,
  giornoDaRimettere,
  metodoDaRimettere,
} from '@/lib/bozza-checkout';
import { FASCE_DI_DOMANI } from '@/lib/quando-arriva';

const FORM = { fullName: 'Anna Rossi', address: 'Via Roma 1', city: 'Piacenza', zip: '29121', phone: '3331234567', notes: '' };

// ─────────────────────────────────────────────────────────────────────────────
// ① Cosa si mette da parte.
// ─────────────────────────────────────────────────────────────────────────────

describe('la bozza che si porta all\'accesso', () => {
  const piena = bozzaDaSalvare({
    form: FORM, couponCode: 'BENVENUTO10', metodoPagamento: 'cod',
    giorno: 'today', fasciaOggi: 'Stasera · 18:00–20:00', fasciaDomani: FASCE_DI_DOMANI[0],
  });

  it('IL CASO: porta anche sconto, pagamento e fascia, non solo l\'indirizzo', () => {
    expect(piena.form).toEqual(FORM);
    expect(piena.couponCode).toBe('BENVENUTO10');
    expect(piena.metodoPagamento).toBe('cod');
    expect(piena.giorno).toBe('today');
    expect(piena.fasciaOggi).toBe('Stasera · 18:00–20:00');
    expect(piena.fasciaDomani).toBe(FASCE_DI_DOMANI[0]);
  });

  it('dello sconto salva il CODICE e mai la cifra', () => {
    const scritta = JSON.stringify(piena);
    expect(scritta).toContain('BENVENUTO10');
    // Nessun campo che somigli a uno sconto già calcolato: sarebbe un numero che il browser può cambiare.
    expect(Object.keys(piena)).not.toContain('discount');
    expect(Object.keys(piena)).not.toContain('appliedCoupon');
    expect(Object.keys(piena)).not.toContain('sconto');
  });

  it('un codice vuoto non finisce nella bozza', () => {
    const senza = bozzaDaSalvare({ form: FORM, couponCode: '   ', metodoPagamento: 'card', giorno: 'tomorrow', fasciaOggi: '', fasciaDomani: FASCE_DI_DOMANI[1] });
    expect(senza.couponCode).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② Una bozza arrivata dal browser non è un oggetto di cui fidarsi.
// ─────────────────────────────────────────────────────────────────────────────

describe('leggere una bozza scritta da chissà chi', () => {
  it('IL CASO: uno sconto scritto a mano nel browser non entra', () => {
    const manomessa = bozzaLetta({
      form: FORM, couponCode: 'BENVENUTO10',
      discount: 9999, appliedCoupon: { discount: 9999 }, freeShipping: true,
    });
    expect(manomessa?.couponCode).toBe('BENVENUTO10');
    expect(manomessa).not.toHaveProperty('discount');
    expect(manomessa).not.toHaveProperty('appliedCoupon');
    expect(manomessa?.form).not.toHaveProperty('discount');
  });

  it('i campi che non sappiamo leggere restano fuori', () => {
    const letta = bozzaLetta({ form: { ...FORM, cattivo: { annidato: true } }, metodoPagamento: 'bonifico', giorno: 'ieri' });
    expect(letta?.form).not.toHaveProperty('cattivo');
    expect(letta?.metodoPagamento).toBeUndefined();
    expect(letta?.giorno).toBeUndefined();
  });

  it('le bozze vecchie — solo il form, senza involucro — si leggono lo stesso', () => {
    const vecchia = bozzaLetta(FORM);
    expect(vecchia?.form).toEqual(FORM);
  });

  it('spazzatura non diventa una bozza', () => {
    for (const niente of [null, undefined, 'ciao', 42, true]) {
      expect(bozzaLetta(niente), `«${String(niente)}» non è una bozza`).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ Cosa si può DAVVERO rimettere al ritorno.
// ─────────────────────────────────────────────────────────────────────────────

describe('il metodo di pagamento', () => {
  it('torna com\'era', () => {
    expect(metodoDaRimettere('cod', true)).toBe('cod');
    expect(metodoDaRimettere('card', true)).toBe('card');
  });

  it('«carta» non si rimette se la carta non è più accettabile', () => {
    // Rimetterla vorrebbe dire riportare la persona su una strada che non porta da nessuna parte.
    expect(metodoDaRimettere('card', false)).toBeNull();
    expect(metodoDaRimettere('cod', false)).toBe('cod');
  });

  it('se non era salvato, non si inventa', () => {
    expect(metodoDaRimettere(undefined, true)).toBeNull();
  });
});

describe('la fascia di consegna', () => {
  it('IL CASO: login alle 19:55, ritorno alle 20:05 — la fascia passata NON torna', () => {
    expect(fasciaDaRimettere('today', 'Stasera · 18:00–20:00', 19)).toBe('Stasera · 18:00–20:00');
    expect(fasciaDaRimettere('today', 'Stasera · 18:00–20:00', 20)).toBeNull();
  });

  it('una fascia di oggi ancora buona torna', () => {
    expect(fasciaDaRimettere('today', 'In giornata · 15:00–18:00', 14)).toBe('In giornata · 15:00–18:00');
  });

  it('domani non scade con l\'ora di oggi', () => {
    for (const ora of [8, 14, 20, 23]) {
      expect(fasciaDaRimettere('tomorrow', FASCE_DI_DOMANI[2], ora)).toBe(FASCE_DI_DOMANI[2]);
    }
  });

  it('una fascia inventata non passa, nemmeno per domani', () => {
    expect(fasciaDaRimettere('tomorrow', 'Domani · alle 3 di notte', 10)).toBeNull();
    expect(fasciaDaRimettere('today', 'Oggi · quando mi pare', 9)).toBeNull();
  });

  it('«adesso» non ha una fascia da rimettere', () => {
    expect(fasciaDaRimettere('now', 'qualunque', 10)).toBeNull();
  });
});

describe('il giorno', () => {
  it('«oggi» non si rimette se per oggi non c\'è più niente', () => {
    expect(giornoDaRimettere('today', 14)).toBe('today');
    expect(giornoDaRimettere('today', 20)).toBeNull();
  });

  it('domani si rimette a qualunque ora', () => {
    expect(giornoDaRimettere('tomorrow', 23)).toBe('tomorrow');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ④ L'invariante sulla pagina vera.
// ─────────────────────────────────────────────────────────────────────────────

describe('l\'invariante sul checkout', () => {
  const src = readFileSync(join(process.cwd(), 'app/checkout/page.tsx'), 'utf8');
  const senzaCommenti = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');

  it('la bozza non è più il solo indirizzo', () => {
    expect(senzaCommenti, 'la forma vecchia salvava solo il form')
      .not.toMatch(/setItem\('mc_checkout_draft',\s*JSON\.stringify\(form\)\)/);
    expect(senzaCommenti, 'deve passare dalla funzione che decide cosa portarsi dietro')
      .toMatch(/bozzaDaSalvare\(/);
  });

  it('quello che torna dal browser passa dal filtro', () => {
    expect(senzaCommenti, 'una bozza si legge, non si spreme dentro il form')
      .not.toMatch(/JSON\.parse\(raw\)\s*as\s*Partial/);
    expect(senzaCommenti).toMatch(/bozzaLetta\(/);
  });

  it('sconto, pagamento e fascia vengono davvero rimessi', () => {
    expect(senzaCommenti, 'il codice sconto torna').toMatch(/setCouponCode\(bozza\.couponCode\)/);
    expect(senzaCommenti, 'il pagamento passa dalla regola').toMatch(/metodoDaRimettere\(/);
    expect(senzaCommenti, 'la fascia passa dalla regola').toMatch(/fasciaDaRimettere\(/);
    expect(senzaCommenti, 'il giorno passa dalla regola').toMatch(/giornoDaRimettere\(/);
  });

  it('lo sconto già calcolato non viene rimesso a mano', () => {
    // La scorciatoia sbagliata: rimettere appliedCoupon dalla bozza, saltando la verifica.
    expect(senzaCommenti).not.toMatch(/setAppliedCoupon\(\s*bozza\./);
  });
});
