/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';
import { domandaPrimaDelBonificoFatto, type VoceDaBonificare } from '@/lib/rimborsi/bonifici-da-fare';

/**
 * 16/10/2026 — UN TOCCO SU «BONIFICO FATTO» SEGNAVA PAGATO UN CLIENTE CHE NON AVEVA RICEVUTO NIENTE.
 *
 * Ogni riga della lista ha il suo pulsante «Bonifico fatto», tutti uguali, e partiva al primo
 * tocco. Dal telefono, con tre bonifici in fila, Nicola tocca per sbaglio il secondo: la riga
 * diventa grigia, il cliente esce dai «Da fare» e — dopo questa stessa correzione — il suo IBAN
 * si cancella. Non c'e' un comando per tornare indietro. Lo si scopriva quando il cliente
 * reclamava.
 *
 * La prova MONTA la pagina vera insieme al dialogo di conferma del sito, tocca «Bonifico fatto» e
 * guarda due cose: che compaia la domanda con la cifra e il conto, e che NIENTE parta finche' la
 * domanda non ha avuto un «si'». Se la pagina torna a segnare al primo tocco, diventa rossa.
 */

const globale = globalThis as Record<string, unknown>;

const R1 = '22222222-2222-4222-8222-222222222222';
const D1 = '33333333-3333-4333-8333-333333333333';

function voce(parziale: Partial<VoceDaBonificare>): VoceDaBonificare {
  return {
    tipo: 'reso',
    id: R1,
    ordineId: 'aaaabbbb-0000-4000-8000-000000000001',
    importoCents: 3000,
    registratoIl: '2026-10-12T10:00:00Z',
    iban: 'IT60 X054 2811 1010 0000 0123 456',
    intestatario: null,
    fattoIl: null,
    daFare: true,
    confermataDallOrdine: true,
    ...parziale,
  };
}

let Banco: ComponentType<Record<string, unknown>>;

beforeAll(async () => {
  const modulo = await monta('tests/unit/aiuti/banco-dei-bonifici-da-fare.tsx');
  Banco = modulo.default as ComponentType<Record<string, unknown>>;
}, 60000);

beforeEach(() => {
  globale.__MUTAZIONI__ = [];
  globale.__DATI_QUERY__ = {
    voci: [voce({}), voce({ tipo: 'reclamo', id: D1, importoCents: 1800, iban: null })],
    migrazione162: true,
  };
});

afterEach(() => {
  delete globale.__MUTAZIONI__;
  delete globale.__DATI_QUERY__;
});

const mutazioni = () => globale.__MUTAZIONI__ as Array<Record<string, unknown>>;
const pulsanti = (radice: ParentNode, testo: string) =>
  Array.from(radice.querySelectorAll('button')).filter((b) => testoVisibile(b) === testo);
const dialogo = () => document.querySelector('[role="dialog"]');

describe('«Bonifico fatto» chiede prima di segnare', () => {
  it('al primo tocco non parte niente: compare la domanda, con la cifra e il conto', async () => {
    const s = accendi(Banco);
    const [primo] = pulsanti(s.radice, 'Bonifico fatto');
    expect(primo, 'la lista non e comparsa: la prova non sta guardando niente').toBeTruthy();

    s.agisci(() => clicca(primo));
    await attendi();

    expect(mutazioni(), 'il bonifico si e segnato fatto al primo tocco, senza nessuna domanda').toHaveLength(0);
    const d = dialogo();
    expect(d, 'nessuna domanda prima di segnare il bonifico').not.toBeNull();
    const testo = testoVisibile(d);
    expect(testo).toContain('30,00');
    expect(testo, 'la domanda non dice su quale conto: chi ha sbagliato riga non se ne accorge').toContain('3456');
    s.smonta();
  }, 60000);

  it('«Non ancora» chiude la domanda e il bonifico resta da fare', async () => {
    const s = accendi(Banco);
    s.agisci(() => clicca(pulsanti(s.radice, 'Bonifico fatto')[0]));
    await attendi();

    const [no] = pulsanti(document, 'Non ancora');
    expect(no, 'nella domanda manca il modo di tirarsi indietro').toBeTruthy();
    s.agisci(() => clicca(no));
    await attendi();

    expect(dialogo()).toBeNull();
    expect(mutazioni(), 'dopo «Non ancora» il bonifico e stato segnato lo stesso').toHaveLength(0);
    s.smonta();
  }, 60000);

  it('solo dopo il «si» si segna, e proprio la voce toccata', async () => {
    const s = accendi(Banco);
    // Il secondo pulsante e' quello del reclamo: si segna lui, non il primo della lista.
    s.agisci(() => clicca(pulsanti(s.radice, 'Bonifico fatto')[1]));
    await attendi();
    expect(testoVisibile(dialogo())).toContain('18,00');

    const [si] = pulsanti(document, "Sì, l'ho fatto");
    expect(si, 'nella domanda manca il pulsante per confermare').toBeTruthy();
    s.agisci(() => clicca(si));
    await attendi();

    expect(mutazioni()).toEqual([{ azione: 'fatto', voce: { tipo: 'reclamo', id: D1 } }]);
    s.smonta();
  }, 60000);
});

describe('la domanda dice quello che serve per riconoscere il bonifico', () => {
  it('cifra, ultime quattro cifre del conto, pratica e ordine', () => {
    const d = domandaPrimaDelBonificoFatto(voce({}));
    // Fra la cifra e l'euro c'e' lo spazio che non si spezza, come in tutto il sito.
    expect(d.title).toMatch(/^Hai fatto il bonifico di 30,00\s€\?$/u);
    expect(d.message).toContain('il reso dell\'ordine #aaaabbbb');
    expect(d.message).toContain('finisce con 3456');
    expect(d.message).toContain('non si torna indietro');
  });

  it('se il cliente ha chiuso l account, nomina anche l intestatario', () => {
    const d = domandaPrimaDelBonificoFatto(voce({ intestatario: 'Giulia Bianchi' }));
    expect(d.message).toContain('intestato a Giulia Bianchi');
  });

  it('senza una cifra certa non ne inventa una', () => {
    const d = domandaPrimaDelBonificoFatto(voce({ importoCents: null, iban: null }));
    expect(d.title).toBe('Hai fatto il bonifico?');
    expect(d.message).not.toMatch(/€/);
  });
});
