import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { vistaDeiCoupon, quantiCodici, type Coupon } from '@/lib/admin/vista-dei-coupon';

/**
 * 8/9/2026 — IL PANNELLO SCRIVEVA «0 CODICI SCONTO» QUANDO NON ERA RIUSCITO A LEGGERLI.
 *
 * `/admin/coupons` leggeva con `const { data: coupons = [], isLoading } = useQuery(...)`. La
 * funzione di lettura l'errore lo solleva, ma la pagina non lo guardava: `= []` lo trasformava in
 * elenco vuoto, e sotto c'era solo `if (isLoading)`. React Query riprova una volta sola e non alza
 * l'errore al confine della pagina: dopo il secondo tentativo `isLoading` torna falso, `data`
 * resta `undefined`, e il ripiego prende il posto del dato.
 *
 * A schermo, una lettura caduta e un pannello davvero vuoto erano identici: stesso titolo, stessa
 * tabella vuota, nessun avviso, nessun «Riprova». L'amministratore concludeva che i codici erano
 * spariti e ne ricreava uno uguale: adesso ce ne sono due, e il secondo non lo guarda nessuno.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────────────────────
 * ① ESEGUE la regola nei quattro stati: sto leggendo · letto e vuoto · letto e pieno · caduta.
 * ② ESEGUE i due modi in cui la caduta si presenta — senza niente in mano, e con l'elenco vuoto
 *    di ripiego in mano — perché è il secondo che scriveva «0 codici sconto».
 * ③ Pretende che sulla caduta il pulsante «Nuovo coupon» sia spento: il doppione non si previene
 *    con una frase, si previene togliendo il pulsante che lo crea.
 * ④ Legge la pagina e pretende che il ripiego `= []` non sia tornato.
 *
 * ⚪ Da qui non apro il pannello nel browser: verifico la regola e chi la chiama, non i pixel.
 */

const PAGINA = readFileSync(join(process.cwd(), 'app/admin/coupons/page.tsx'), 'utf8');
/** Il codice senza i commenti: lì il difetto vecchio è citato per iscritto, e non va contato. */
const CODICE = PAGINA.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function coupon(code: string): Coupon {
  return {
    id: `id-${code}`,
    code,
    type: 'PERCENT',
    value: 10,
    min_subtotal: 0,
    max_uses: null,
    uses_count: 0,
    first_order_only: false,
    active: true,
    description: null,
  };
}

describe('il plurale lo dice giusto', () => {
  it('uno solo', () => expect(quantiCodici(1)).toBe('1 codice sconto'));
  it('nessuno e tanti', () => {
    expect(quantiCodici(0)).toBe('0 codici sconto');
    expect(quantiCodici(3)).toBe('3 codici sconto');
  });
});

describe('sto ancora leggendo', () => {
  it('non dice un numero che non ha letto', () => {
    const v = vistaDeiCoupon({ isPending: true, isError: false, data: undefined });
    expect(v.stato).toBe('carico');
    expect(v.mostraScheletro).toBe(true);
    expect(v.sottotitolo).not.toMatch(/\d+ codici sconto/);
    expect(v.permettiCreazione).toBe(false);
  });

  it('React Query ha smesso di provare e non ha dato niente: resta «non lo so», non «vuoto»', () => {
    // Il caso vero: `isPending` falso, nessun errore alzato, `data` mai arrivato.
    const v = vistaDeiCoupon({ isPending: false, isError: false, data: undefined });
    expect(v.stato).toBe('carico');
    expect(v.mostraVuoto).toBe(false);
    expect(v.sottotitolo).not.toContain('0 codici sconto');
  });
});

describe('ho letto davvero', () => {
  it('e non c’è niente: «vuoto» adesso è un’affermazione che si può sostenere', () => {
    const v = vistaDeiCoupon({ isPending: false, isError: false, data: [] });
    expect(v.stato).toBe('vuoto');
    expect(v.mostraVuoto).toBe(true);
    expect(v.sottotitolo).toBe('0 codici sconto');
    expect(v.permettiCreazione).toBe(true);
    expect(v.avviso).toBeNull();
  });

  it('e ce ne sono due: li conta e li mostra', () => {
    const v = vistaDeiCoupon({ isPending: false, isError: false, data: [coupon('ESTATE25'), coupon('BENVENUTO')] });
    expect(v.stato).toBe('pieno');
    expect(v.sottotitolo).toBe('2 codici sconto');
    expect(v.coupons.map((c) => c.code)).toEqual(['ESTATE25', 'BENVENUTO']);
    expect(v.mostraErrore).toBe(false);
  });
});

describe('la lettura è caduta', () => {
  it('senza niente in mano: lo dice, e non scrive un numero', () => {
    const v = vistaDeiCoupon({ isPending: false, isError: true, error: new Error('Failed to fetch'), data: undefined });
    expect(v.stato).toBe('rotto');
    expect(v.mostraErrore).toBe(true);
    expect(v.mostraVuoto).toBe(false);
    expect(v.sottotitolo).not.toMatch(/\d+ codici sconto/);
    expect(v.avviso?.titolo).toContain('Non riesco a leggere');
  });

  it('con l’elenco vuoto di ripiego in mano: NON diventa «0 codici sconto»', () => {
    // È la forma esatta del difetto: `data` vuoto per ripiego e l'errore ignorato.
    const v = vistaDeiCoupon({ isPending: false, isError: true, error: new Error('Failed to fetch'), data: [] });
    expect(v.stato).toBe('rotto');
    expect(v.sottotitolo).not.toContain('0 codici sconto');
    expect(v.mostraVuoto).toBe(false);
    expect(v.mostraErrore).toBe(true);
  });

  it('il pulsante «Nuovo coupon» è spento: è così che si evita il doppione', () => {
    const v = vistaDeiCoupon({ isPending: false, isError: true, error: new Error('giù'), data: [] });
    expect(v.permettiCreazione).toBe(false);
    expect(v.avviso?.dettaglio).toContain('due uguali');
  });

  it('l’elenco non si mostra: quello che c’è in mano non è quello che c’è nel database', () => {
    const v = vistaDeiCoupon({ isPending: false, isError: true, error: new Error('giù'), data: [coupon('VECCHIO')] });
    expect(v.coupons).toHaveLength(0);
    expect(v.mostraErrore).toBe(true);
  });
});

describe('la pagina dei coupon usa questa regola, e non ne ha una sua', () => {
  it('chiama `vistaDeiCoupon` e non tiene un ramo suo', () => {
    expect(CODICE).toContain('vistaDeiCoupon(');
    expect(CODICE).toContain('vista.mostraErrore');
    expect(CODICE).toContain('vista.sottotitolo');
  });

  it('il ripiego `= []` sulla lettura non c’è più', () => {
    expect(CODICE).not.toMatch(/data:\s*coupons\s*=\s*\[\]/);
    expect(CODICE).not.toMatch(/=\s*useQuery[\s\S]{0,80}=\s*\[\]/);
  });

  it('quando la lettura è caduta si può riprovare', () => {
    expect(CODICE).toContain('refetch');
    expect(CODICE).toContain('ErrorState');
  });
});
