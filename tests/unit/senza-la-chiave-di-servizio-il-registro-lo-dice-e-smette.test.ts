/**
 * 3/9/2026 — DIECI VOLTE LO STESSO GUASTO, E NESSUNO CHE LO VEDESSE.
 *
 * Dal 18 agosto al 2 settembre la registrazione dell'attività è caduta dieci
 * volte su dieci, sempre con lo stesso motivo: «Service role Supabase non
 * configurato (SUPABASE_SERVICE_ROLE_KEY)». La chiave di servizio non era stata
 * messa fra le variabili di produzione, e senza quella il sito non può scrivere
 * nella tabella dell'attività.
 *
 * Il danno vero non è la chiave che manca: è che nessuno se ne accorgeva. Ogni
 * caduta finiva in un `console.error`, che in produzione non sveglia nessuno e
 * non arriva a Sentry. Le viste prodotto e l'«attività dal vivo» restavano a
 * zero anche col traffico vero, e sembrava soltanto che non passasse nessuno.
 * Un guasto che nessuno vede è un guasto che dura mesi.
 *
 * Due cose devono essere vere adesso:
 *  ① il guasto lo DICE — una volta, forte, dove gli errori si guardano;
 *  ② non ritenta all'infinito — una variabile assente non ricompare da sola.
 *
 * E la differenza che conta: un guasto passeggero (il database irraggiungibile
 * per un attimo) NON spegne niente, perché quello si risolve da solo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const errori: unknown[] = [];
const avvisi: string[] = [];
vi.mock('@/lib/logger', () => ({
  logger: {
    error: (err: unknown) => { errori.push(err); },
    warn: (msg: string) => { avvisi.push(msg); },
    info: () => {},
    spesa: () => {},
  },
}));

/** Quante volte si è provato ad aprire la porta del database. */
let tentativi = 0;
/** Cosa fa il client amministrativo quando lo si chiede. */
let comeRisponde: () => unknown = () => { throw new Error('non impostato'); };

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => {
    tentativi++;
    return comeRisponde();
  },
}));

import { recordActivity, statoDellaRegistrazione, __riaccendiRegistrazione } from '@/lib/activity';

/** L'errore vero, parola per parola, come lo lancia lib/env.ts in produzione. */
const CHIAVE_MANCANTE = () => {
  throw new Error('Service role Supabase non configurato (SUPABASE_SERVICE_ROLE_KEY).');
};

/** Un client che accetta la scrittura senza fare storie. */
const DATABASE_A_POSTO = () => ({ from: () => ({ insert: async () => ({ error: null }) }) });

const unaVisita = () =>
  recordActivity({ category: 'visitor', eventType: 'page_view', path: '/', summary: 'Pagina vista: /' });

beforeEach(() => {
  errori.length = 0;
  avvisi.length = 0;
  tentativi = 0;
  __riaccendiRegistrazione();
});

describe('quando in produzione manca la chiave di servizio', () => {
  it("IL CASO CHE ROMPEVA — dieci visite, un tentativo solo: non si ritenta all'infinito", async () => {
    comeRisponde = CHIAVE_MANCANTE;

    for (let i = 0; i < 10; i++) await unaVisita();

    expect(
      tentativi,
      'si continua a bussare a una porta che non c\'è: dieci errori identici invece di uno',
    ).toBe(1);
    expect(statoDellaRegistrazione().spenta).toBe(true);
    expect(statoDellaRegistrazione().scartate, 'le scritture buttate via non si contano').toBe(9);
  });

  it('IL CASO CHE ROMPEVA — il guasto lo dice, e dice cosa manca e cosa smette di funzionare', async () => {
    comeRisponde = CHIAVE_MANCANTE;

    for (let i = 0; i < 10; i++) await unaVisita();

    expect(errori.length, 'il guasto non arriva dove gli errori si guardano, oppure arriva dieci volte').toBe(1);
    const detto = errori[0] instanceof Error ? (errori[0] as Error).message : String(errori[0]);
    expect(detto, 'chi legge non sa quale variabile manca').toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(detto.toLowerCase(), 'chi legge non sa cosa ha smesso di funzionare').toContain('accessi');
  });

  it('e non scrive più niente: la porta non si riapre da sola a metà giornata', async () => {
    comeRisponde = CHIAVE_MANCANTE;
    await unaVisita();
    expect(statoDellaRegistrazione().spenta).toBe(true);

    // La chiave nel frattempo non è comparsa: il processo va ripubblicato.
    comeRisponde = DATABASE_A_POSTO;
    await unaVisita();
    expect(tentativi, 'si è ritentato: allora l\'allarme tornerà a ripetersi a ogni beacon').toBe(1);
  });
});

describe('quando invece è un guasto passeggero', () => {
  it('NON spegne niente: quello si risolve da solo e va ritentato', async () => {
    comeRisponde = () => { throw new Error('fetch failed: il database non risponde'); };

    for (let i = 0; i < 3; i++) await unaVisita();

    expect(tentativi, 'un guasto passeggero ha spento la registrazione: si perde tutto per un attimo di rete').toBe(3);
    expect(statoDellaRegistrazione().spenta).toBe(false);
    expect(errori.length, 'un attimo di rete non è un allarme da svegliare qualcuno').toBe(0);
    expect(avvisi.length).toBe(3);
  });

  it('e con il database a posto scrive e basta, senza rumore', async () => {
    comeRisponde = DATABASE_A_POSTO;
    await unaVisita();
    expect(statoDellaRegistrazione().spenta).toBe(false);
    expect(errori.length).toBe(0);
    expect(avvisi.length).toBe(0);
  });

  it("il doppione rifiutato dal vincolo di unicità non è un guasto: è la seconda copia dello stesso accesso", async () => {
    comeRisponde = () => ({
      from: () => ({ insert: async () => ({ error: { code: '23505', message: 'duplicate key' } }) }),
    });
    await recordActivity({ category: 'auth', eventType: 'login', userId: 'u1', sessionId: 's1' });
    expect(avvisi.length, 'il doppione previsto viene segnalato come se fosse un guasto').toBe(0);
    expect(errori.length).toBe(0);
  });
});
