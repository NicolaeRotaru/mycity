/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { cosaDiceLaVoce, type VoceDaBonificare } from '@/lib/rimborsi/bonifici-da-fare';

/**
 * Riesame del 16/10, terzo giro — DUE COSE CHE LA PAGINA DEI BONIFICI DICEVA SBAGLIATE.
 *
 *  ① «IBAN non indicato… Quando arriva, scrivilo qui» compariva su ogni voce senza IBAN, anche su
 *    quelle gia' pagate: col «fatto» l'IBAN si cancella apposta, e li' il campo per scriverlo non
 *    c'e'. Il bonifico da 18 € del 1° ottobre, segnato fatto il 2, diceva in grigio «Fatto il 2/10»
 *    e accanto «scrivilo qui»: chi paga si metteva a cercare un IBAN per un bonifico gia' fatto.
 *  ② Una riga di reso che il cliente si e' scritto da solo (in produzione, senza la 153, puo')
 *    stava fra i bonifici da pagare come le altre. Al terzo giro andava in un riquadro a parte «da
 *    controllare»; dal sesto giro non entra proprio nella lista (lo prova
 *    la-lista-dei-bonifici-nasce-dal-segno-sull-ordine.test.ts), e la pagina ha un elenco solo.
 *
 * La prova MONTA la pagina vera e legge quello che legge chi paga.
 */

const globale = globalThis as Record<string, unknown>;

function voce(parziale: Partial<VoceDaBonificare>): VoceDaBonificare {
  return {
    tipo: 'reso',
    id: '22222222-2222-4222-8222-222222222222',
    ordineId: 'aaaabbbb-0000-4000-8000-000000000001',
    importoCents: 1800,
    registratoIl: '2026-10-01T10:00:00Z',
    iban: null,
    intestatario: null,
    fattoIl: null,
    daFare: true,
    ...parziale,
  };
}

let Banco: ComponentType<Record<string, unknown>>;

beforeAll(async () => {
  Banco = (await monta('tests/unit/aiuti/banco-dei-bonifici-da-fare.tsx')).default as ComponentType<Record<string, unknown>>;
}, 60000);

afterEach(() => {
  delete globale.__MUTAZIONI__;
  delete globale.__DATI_QUERY__;
});

function leggiLaPagina(dati: Record<string, unknown>) {
  globale.__MUTAZIONI__ = [];
  globale.__DATI_QUERY__ = dati;
  const s = accendi(Banco);
  const elenchi = Array.from(s.radice.querySelectorAll('ul'));
  const righe = (ul: Element | undefined) => Array.from(ul?.querySelectorAll(':scope > li') ?? []).map((li) => testoVisibile(li));
  return { s, elenchi, righe };
}

describe('① accanto a un IBAN che manca, la pagina dice la cosa giusta', () => {
  it('IL CASO CHE ROMPEVA — sul bonifico gia fatto non dice «scrivilo qui»: dice che l IBAN e stato cancellato', () => {
    const { s, elenchi, righe } = leggiLaPagina({
      voci: [voce({ id: '33333333-3333-4333-8333-333333333333', daFare: false, fattoIl: '2026-10-02T09:00:00Z' })],
      migrazione162: true,
    });
    const [riga] = righe(elenchi[0]);
    expect(riga, 'la voce fatta non e comparsa: la prova non sta guardando niente').toContain('Fatto il');
    expect(riga, 'su un bonifico gia fatto la pagina chiede di scrivere un IBAN dove il campo non c e').not.toContain('scrivilo qui');
    expect(riga).toContain('IBAN cancellato dopo il bonifico');
    s.smonta();
  }, 60000);

  it('sul bonifico da fare, con la 162, dice «scrivilo qui» e il campo c e', () => {
    const { s, elenchi, righe } = leggiLaPagina({ voci: [voce({})], migrazione162: true });
    expect(righe(elenchi[0])[0]).toContain('scrivilo qui');
    expect(s.radice.querySelector('input'), 'la pagina dice «scrivilo qui» ma il campo non c e').not.toBeNull();
    s.smonta();
  }, 60000);

  it('senza la 162 non promette un campo che non c e: dice di tenerlo a parte', () => {
    const { s, elenchi, righe } = leggiLaPagina({ voci: [voce({})], migrazione162: false });
    const riga = righe(elenchi[0])[0];
    expect(riga).not.toContain('scrivilo qui');
    expect(riga).toContain('tienilo a parte');
    expect(s.radice.querySelector('input')).toBeNull();
    s.smonta();
  }, 60000);
});

describe('② la pagina ha un elenco solo: niente riquadro «da controllare»', () => {
  it('anche se una risposta vecchia portasse ancora «daControllare», la pagina non lo mostra', () => {
    const finta = voce({ id: '99999999-9999-4999-8999-999999999999', importoCents: 95000 });
    const { s, elenchi, righe } = leggiLaPagina({ voci: [voce({ iban: 'IT12 A000 0000 0000 0000 0000 001' })], daControllare: [finta], migrazione162: true });

    expect(elenchi, 'la pagina mostra ancora un secondo elenco').toHaveLength(1);
    expect(righe(elenchi[0]).join(' ')).not.toMatch(/950,00/u);
    expect(testoVisibile(s.radice), 'la pagina chiede ancora un controllo che da qui non si fa').not.toMatch(/controllare prima di pagare|non pagar/u);
    s.smonta();
  }, 60000);
});

describe('la regola, come funzione', () => {
  it('fatto senza IBAN: niente campo; da fare senza 162: niente campo', () => {
    expect(cosaDiceLaVoce(voce({ daFare: false }), true)).toMatchObject({ campoPerLIban: false });
    expect(cosaDiceLaVoce(voce({}), false).campoPerLIban).toBe(false);
    expect(cosaDiceLaVoce(voce({}), true).campoPerLIban).toBe(true);
    expect(cosaDiceLaVoce(voce({ iban: 'IT60 X054' }), true).alPostoDellIban).toBeNull();
  });
});
