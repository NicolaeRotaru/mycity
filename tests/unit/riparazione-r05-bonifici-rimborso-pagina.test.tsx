// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { disegna, aspetta } from './aiuti/cabina-admin';
import {
  allarmiDeiBonifici,
  elencoDeiBonifici,
  fraseDelTermine,
  messaggioDelSegno,
  termineDelBonifico,
  urgenzaDelTermine,
  type RigaDelBonifico,
} from '@/lib/rimborsi/bonifici-da-fare';

/**
 * R05 (26/11/2026) — LA PAGINA DEI BONIFICI DI RIMBORSO.
 *
 * Prima nessuna pagina elencava i bonifici da fare ai clienti che avevano pagato in contanti:
 * restava un avviso nella campanella, che scivola via dopo cinquanta notifiche, e nessuno guardava
 * il termine dei 14 giorni. Qui: l'elenco ordinato per termine, il segno ben visibile a 3 giorni o
 * meno e a termine passato, «termine sconosciuto» per i reclami senza giorno di partenza, «Fatto»
 * una volta sola (il secondo legge chi e quando) e «Respinto dalla banca» che lo rimette da fare.
 * L'orologio è finto: sabato 14 novembre 2026, le 11 a Piacenza.
 */

const ADESSO = new Date('2026-11-14T10:00:00Z');

function riga(r: Partial<RigaDelBonifico> & { chiave: string }): RigaDelBonifico {
  return {
    order_id: 'a1b2c3d4-0000-0000-0000-000000000001',
    centesimi: 3000,
    cliente_nome: 'Giulia Rossi',
    cliente_email: 'giulia@esempio.it',
    chiesto_il: null,
    stato: 'DA_FARE',
    fatto_da_nome: null,
    fatto_il: null,
    respinto_da_nome: null,
    respinto_il: null,
    ...r,
  };
}

const RIGHE: RigaDelBonifico[] = [
  riga({ chiave: 'return_aaaaaa01-1', chiesto_il: '2026-11-02T10:00:00Z' }), // termine 16/11: mancano 2 giorni
  riga({ chiave: 'return_bbbbbb02-1', chiesto_il: '2026-10-28T10:00:00Z', centesimi: 1250 }), // termine 11/11: passato
  riga({ chiave: 'dispute_cccccc03-1', centesimi: 2400 }), // reclamo: termine sconosciuto
  riga({ chiave: 'return_dddddd04-1', chiesto_il: '2026-11-10T10:00:00Z' }), // termine 24/11: c'è tempo
  riga({
    chiave: 'return_eeeeee05-1', chiesto_il: '2026-11-01T10:00:00Z', stato: 'FATTO',
    fatto_da_nome: 'Anna Conti', fatto_il: '2026-11-13T15:05:00Z',
  }),
  riga({
    chiave: 'return_ffffff06-1', chiesto_il: '2026-11-05T10:00:00Z', stato: 'RESPINTO',
    fatto_da_nome: 'Anna Conti', fatto_il: '2026-11-10T09:00:00Z', respinto_da_nome: 'Bruno Verdi', respinto_il: '2026-11-12T08:30:00Z',
  }),
];

describe('R05 — i conti della pagina dei bonifici', () => {
  it('da fare: tutti i non fatti (anche il respinto), ordinati per termine; lo sconosciuto conta come oggi', () => {
    const { daFare, fatti } = elencoDeiBonifici(RIGHE, ADESSO);
    expect(daFare.map((b) => b.chiave)).toEqual([
      'return_bbbbbb02-1', 'dispute_cccccc03-1', 'return_aaaaaa01-1', 'return_ffffff06-1', 'return_dddddd04-1',
    ]);
    expect(fatti.map((b) => b.chiave)).toEqual(['return_eeeeee05-1']);
  });

  it('in evidenza: termine passato, sconosciuto, o a 3 giorni o meno; non quello che ha tempo', () => {
    const { daFare } = elencoDeiBonifici(RIGHE, ADESSO);
    const per = Object.fromEntries(daFare.map((b) => [b.chiave, b]));
    expect(per['return_bbbbbb02-1'].urgenza).toEqual({ tipo: 'passato', giorni: 3 });
    expect(per['dispute_cccccc03-1'].urgenza).toEqual({ tipo: 'sconosciuto' });
    expect(per['return_aaaaaa01-1'].urgenza).toEqual({ tipo: 'vicino', giorni: 2 });
    expect(per['return_dddddd04-1'].urgenza).toEqual({ tipo: 'in_tempo', giorni: 10 });
    expect(daFare.filter((b) => b.inEvidenza).map((b) => b.chiave).sort()).toEqual([
      'dispute_cccccc03-1', 'return_aaaaaa01-1', 'return_bbbbbb02-1',
    ]);
    expect(per['return_bbbbbb02-1'].causale).toBe('Rimborso MyCity ordine #A1B2C3 reso BBBBBB');
  });

  it('i giorni si contano a calendario di Piacenza: oggi, 3 giorni, 4 giorni, ieri', () => {
    const termine = (giorno: string) => new Date(`${giorno}T12:00:00Z`);
    expect(urgenzaDelTermine(termine('2026-11-14'), ADESSO)).toEqual({ tipo: 'vicino', giorni: 0 });
    expect(urgenzaDelTermine(termine('2026-11-17'), ADESSO)).toEqual({ tipo: 'vicino', giorni: 3 });
    expect(urgenzaDelTermine(termine('2026-11-18'), ADESSO)).toEqual({ tipo: 'in_tempo', giorni: 4 });
    expect(urgenzaDelTermine(termine('2026-11-13'), ADESSO)).toEqual({ tipo: 'passato', giorni: 1 });
    // Le 23:30 UTC del 14 sono già le 00:30 del 15 a Piacenza: il termine del 14 è passato.
    expect(urgenzaDelTermine(termine('2026-11-14'), new Date('2026-11-14T23:30:00Z'))).toEqual({ tipo: 'passato', giorni: 1 });
    expect(urgenzaDelTermine(termine('2026-11-14'), new Date('2026-11-14T22:30:00Z'))).toEqual({ tipo: 'vicino', giorni: 0 });
    expect(fraseDelTermine(termine('2026-11-14'), ADESSO)).toBe('Scade oggi (14 novembre 2026).');
    expect(fraseDelTermine(termine('2026-11-15'), ADESSO)).toBe('Scade domani (15 novembre 2026).');
    expect(fraseDelTermine(termine('2026-11-13'), ADESSO)).toBe('Termine passato da 1 giorno (13 novembre 2026).');
    expect(fraseDelTermine(termine('2026-11-24'), ADESSO)).toBe('Termine: 24 novembre 2026, fra 10 giorni.');
    expect(fraseDelTermine(null, ADESSO)).toContain('Termine sconosciuto');
    // Il termine di un reso chiesto il 2 novembre è il 16, come nell'avviso.
    expect(termineDelBonifico('2026-11-02T10:00:00Z')?.toISOString()).toBe('2026-11-16T12:00:00.000Z');
    expect(termineDelBonifico(null)).toBeNull();
  });

  it('gli allarmi del termine: solo i da fare a 3 giorni o meno o scaduti, mai i fatti né quelli senza termine', () => {
    const allarmi = allarmiDeiBonifici(RIGHE, ADESSO);
    expect(allarmi.map((a) => a.key)).toEqual([
      'BONIFICO_RIMBORSO_SCADUTO|return_bbbbbb02-1',
      'BONIFICO_RIMBORSO_IN_SCADENZA|return_aaaaaa01-1',
    ]);
    expect(allarmi[0]).toMatchObject({ type: 'BONIFICO_RIMBORSO_SCADUTO', url: '/admin/bonifici-rimborso', unaVoltaAlGiorno: true });
    expect(allarmi[0].detail).toContain('«Rimborso MyCity ordine #A1B2C3 reso BBBBBB»');
    expect(allarmi[0].detail).toContain('Termine passato da 3 giorni (11 novembre 2026).');
    expect(allarmi[1].detail).toContain('Mancano 2 giorni al termine (16 novembre 2026).');
    // Quattro giorni prima ancora niente; tre giorni prima sì.
    const unoSolo = [riga({ chiave: 'return_gggggg07-1', chiesto_il: '2026-11-04T10:00:00Z' })]; // termine 18/11
    expect(allarmiDeiBonifici(unoSolo, ADESSO)).toHaveLength(0);
    expect(allarmiDeiBonifici(unoSolo, new Date('2026-11-15T07:00:00Z'))).toHaveLength(1);
    // Fatto: niente allarme, anche a termine passato.
    expect(allarmiDeiBonifici([{ ...unoSolo[0], stato: 'FATTO' }], new Date('2026-11-20T07:00:00Z'))).toHaveLength(0);
  });

  it('«già fatto» dice chi e a che ora; un altro giorno dice anche il giorno', () => {
    expect(messaggioDelSegno({ ok: false, reason: 'GIA_FATTO', fatto_da_nome: 'Anna Conti', fatto_il: '2026-11-14T08:05:00Z' }, ADESSO))
      .toEqual({ ok: false, testo: 'Già fatto da Anna Conti alle 09:05: non rifarlo.' });
    expect(messaggioDelSegno({ ok: false, reason: 'GIA_FATTO', fatto_da_nome: 'Anna Conti', fatto_il: '2026-11-13T15:05:00Z' }, ADESSO).testo)
      .toBe('Già fatto da Anna Conti il 13 novembre alle 16:05: non rifarlo.');
    expect(messaggioDelSegno({ ok: true, stato: 'RESPINTO' }, ADESSO).testo).toContain('è tornato fra i bonifici da fare');
    expect(messaggioDelSegno({ ok: false, reason: 'NON_FATTO' }, ADESSO).ok).toBe(false);
    expect(messaggioDelSegno(null, ADESSO).testo).toBe('Non sono riuscito a segnarlo: riprova.');
  });
});

// ── La pagina, aperta in un browser finto ─────────────────────────────────────────────────────

const chiamate: Array<{ nome: string; args: unknown }> = [];
let righe: unknown[] = [];
let risposta: unknown = { ok: true, stato: 'FATTO' };
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: async (nome: string, args?: unknown) => {
      chiamate.push({ nome, args });
      return { data: nome === 'admin_bonifici_rimborso' ? righe : risposta, error: null };
    },
    from: () => {
      throw new Error('la pagina legge solo con admin_bonifici_rimborso');
    },
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));

let chiudi: (() => void) | null = null;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  chiamate.length = 0;
  righe = RIGHE;
  risposta = { ok: true, stato: 'FATTO' };
  window.confirm = vi.fn(() => true);
});
afterEach(() => {
  chiudi?.();
  chiudi = null;
  vi.useRealTimers();
});

async function apri() {
  const mod = (await import('@/app/admin/bonifici-rimborso/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}
const bottoni = (host: HTMLElement, testo: string) =>
  [...host.querySelectorAll('button')].filter((b) => b.textContent?.includes(testo)) as HTMLButtonElement[];
async function clic(el: HTMLElement | undefined) {
  await act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await aspetta();
}

describe('R05 — la pagina /admin/bonifici-rimborso', () => {
  it('elenca i bonifici da fare per termine, col segno sui vicini, sui passati e sullo sconosciuto; i fatti in fondo', async () => {
    const host = await apri();
    const testo = host.textContent ?? '';
    const pos = (s: string) => testo.indexOf(s);
    expect(pos('reso BBBBBB')).toBeGreaterThan(-1);
    expect(pos('reso BBBBBB')).toBeLessThan(pos('reclamo CCCCCC'));
    expect(pos('reclamo CCCCCC')).toBeLessThan(pos('reso AAAAAA'));
    expect(pos('reso AAAAAA')).toBeLessThan(pos('reso FFFFFF'));
    expect(pos('reso FFFFFF')).toBeLessThan(pos('reso DDDDDD'));
    expect(pos('reso DDDDDD')).toBeLessThan(pos('reso EEEEEE'));

    const segni = [...host.querySelectorAll('[role="status"]')].map((n) => n.textContent ?? '');
    expect(segni).toContain('Termine passato da 3 giorni (11 novembre 2026).');
    expect(segni).toContain('Mancano 2 giorni al termine (16 novembre 2026).');
    expect(segni.some((s) => s.startsWith('Termine sconosciuto'))).toBe(true);
    expect(segni.some((s) => s.includes('24 novembre')), 'quello che ha tempo non va in evidenza').toBe(false);

    expect(testo).toContain('12,50');
    expect(testo).toContain('Giulia Rossi');
    expect(testo).toContain('prendilo solo da una risposta che arriva da giulia@esempio.it');
    expect(testo).toContain('Respinto dalla banca da Bruno Verdi il 12 novembre alle 09:30: va rifatto.');
    expect(testo).toContain('Fatto da Anna Conti il 13 novembre alle 16:05');
    expect(bottoni(host, 'Fatto').filter((b) => b.textContent === 'Fatto')).toHaveLength(5);
    expect(bottoni(host, 'Respinto dalla banca')).toHaveLength(1);
  });

  it('«Fatto» manda ordine, chiave, cifra ed esito; se un altro l ha già fatto, lo dice con chi e quando', async () => {
    const host = await apri();
    risposta = { ok: false, reason: 'GIA_FATTO', fatto_da_nome: 'Anna Conti', fatto_il: '2026-11-14T09:58:00Z' };
    await clic(bottoni(host, 'Fatto').find((b) => b.textContent === 'Fatto'));
    const segnata = chiamate.find((c) => c.nome === 'admin_segna_bonifico_rimborso');
    expect(segnata?.args).toEqual({
      p_order_id: 'a1b2c3d4-0000-0000-0000-000000000001', p_chiave: 'return_bbbbbb02-1', p_centesimi: 1250, p_esito: 'FATTO',
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Già fatto da Anna Conti alle 10:58: non rifarlo.');
  });

  it('«Respinto dalla banca» sta fra i fatti e manda RESPINTO', async () => {
    const host = await apri();
    risposta = { ok: true, stato: 'RESPINTO' };
    await clic(bottoni(host, 'Respinto dalla banca')[0]);
    const segnata = chiamate.find((c) => c.nome === 'admin_segna_bonifico_rimborso');
    expect(segnata?.args).toMatchObject({ p_chiave: 'return_eeeeee05-1', p_esito: 'RESPINTO' });
    expect(host.textContent).toContain('è tornato fra i bonifici da fare');
  });

  it('senza conferma non parte niente', async () => {
    const host = await apri();
    window.confirm = vi.fn(() => false);
    await clic(bottoni(host, 'Fatto').find((b) => b.textContent === 'Fatto'));
    expect(chiamate.filter((c) => c.nome === 'admin_segna_bonifico_rimborso')).toHaveLength(0);
  });
});
