import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * 3/9/2026 — LA TERZA PORTA: SI APPROVAVA SENZA MAI GUARDARE L'ETÀ.
 *
 * Prova eseguita sul database ricostruito dalle migrazioni: con il ruolo di un
 * fattorino è stata scritta una data di nascita di quindici anni fa, poi lo
 * staff ha approvato, e il risultato è stato «rider di 15 anni, stato approved,
 * approvato=true». Nessuno confrontava quella data con i diciotto anni: né il
 * modulo, né il database, né questa rotta — e la schermata di approvazione la
 * data di nascita non la mostra nemmeno. L'unica barriera era l'occhio di chi
 * apre la foto del documento.
 *
 * Sotto i 16 anni è lavoro minorile e basta; fra i 16 e i 18 ci sono vincoli
 * precisi; la polizza RC può non coprire. Le condizioni d'uso, al punto 3,
 * dicono diciotto.
 *
 * ⚠️ La regola di questa porta è al contrario di quella del modulo: qui la data
 * VUOTA non blocca. Da `/api/admin/users/[id]/moderate` passano anche i negozi
 * e le persone iscritte prima che il campo esistesse, e non è questa la
 * schermata dove si chiede una data di nascita. Le ultime due prove sono lì
 * apposta: una riparazione non deve rompere un'altra strada.
 */

const ADMIN = { id: 'admin-1', email: 'a@x.com' };
let idBersaglio = 'rider-1';

vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth:
    (h: (ctx: { req: Request; user: typeof ADMIN; params: { id: string } }) => unknown) =>
    (req: Request) =>
      h({ req, user: ADMIN, params: { id: idBersaglio } }),
}));

let profiloBersaglio: Record<string, unknown> | null = null;
let aggiornamentiProfilo: Record<string, unknown>[] = [];
let notificheInviate: Record<string, unknown>[] = [];

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) =>
      tabella === 'profiles'
        ? {
            select: () => ({
              eq: () => ({
                single: () => Promise.resolve({ data: profiloBersaglio, error: null }),
              }),
            }),
            update: (patch: Record<string, unknown>) => {
              aggiornamentiProfilo.push(patch);
              return { eq: () => Promise.resolve({ error: null }) };
            },
          }
        : {
            insert: (riga: Record<string, unknown>) => {
              notificheInviate.push(riga);
              return Promise.resolve({ error: null });
            },
          },
  }),
}));

vi.mock('@/lib/audit', () => ({ writeAudit: () => Promise.resolve() }));

import { POST as MODERA } from '@/app/api/admin/users/[id]/moderate/route';

/** Quanti anni fa, in data `AAAA-MM-GG`. */
function nataAnniFa(anni: number): string {
  const oggi = new Date();
  return new Date(Date.UTC(oggi.getUTCFullYear() - anni, oggi.getUTCMonth(), oggi.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

function richiesta(action: string): never {
  return new Request('http://localhost/api/admin/users/rider-1/moderate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  aggiornamentiProfilo = [];
  notificheInviate = [];
  idBersaglio = 'rider-1';
  profiloBersaglio = null;
});

describe('lo staff non può approvare un fattorino minorenne', () => {
  it('quindici anni: «approva» viene rifiutato e il profilo non cambia', async () => {
    profiloBersaglio = {
      id: 'rider-1', role: 'rider', store_name: null, full_name: 'Minore Prova',
      legal_birth_date: nataAnniFa(15),
    };

    const r = await MODERA(richiesta('approve'));
    const corpo = await r.json();

    expect(r.status, 'un fattorino di quindici anni arriva allo stato «approvato»').toBe(403);
    expect(corpo.error.message).toContain('18');
    expect(
      aggiornamentiProfilo,
      'il profilo di un minorenne è stato messo in stato approvato',
    ).toEqual([]);
    expect(notificheInviate, 'al minorenne è arrivata la notifica «profilo approvato»').toEqual([]);
  });

  it('nemmeno «riattiva»: è la stessa approvazione con un altro nome', async () => {
    profiloBersaglio = {
      id: 'rider-1', role: 'rider', store_name: null, full_name: 'Minore Prova',
      legal_birth_date: nataAnniFa(17),
    };

    const r = await MODERA(richiesta('reactivate'));

    expect(r.status, 'il minorenne rientra dalla porta «riattiva»').toBe(403);
    expect(aggiornamentiProfilo).toEqual([]);
  });

  it('sospendere e rifiutare restano possibili: quelle non sono approvazioni', async () => {
    profiloBersaglio = {
      id: 'rider-1', role: 'rider', store_name: null, full_name: 'Minore Prova',
      legal_birth_date: nataAnniFa(15),
    };

    const r = await MODERA(richiesta('suspend'));

    expect(r.status, 'non si riesce più nemmeno a sospendere un minorenne').toBe(200);
    expect(aggiornamentiProfilo[0]).toMatchObject({ approval_status: 'suspended', is_approved: false });
  });
});

describe('la riparazione non blocca chi ha l età, né chi la data non ce l ha', () => {
  it('trent anni: si approva come prima', async () => {
    profiloBersaglio = {
      id: 'rider-1', role: 'rider', store_name: null, full_name: 'Luca Rossi',
      legal_birth_date: nataAnniFa(30),
    };

    const r = await MODERA(richiesta('approve'));

    expect(r.status, 'un maggiorenne non si riesce più ad approvare').toBe(200);
    expect(aggiornamentiProfilo[0]).toMatchObject({ approval_status: 'approved', is_approved: true });
  });

  it('negozio senza data di nascita: si approva lo stesso, non è questa la schermata dove si chiede', async () => {
    profiloBersaglio = {
      id: 'seller-9', role: 'seller', store_name: 'Pane Quotidiano', full_name: null,
      legal_birth_date: null,
    };

    const r = await MODERA(richiesta('approve'));

    expect(
      r.status,
      'i negozi iscritti prima che il campo esistesse non si approvano più: riparazione che ne rompe un altra',
    ).toBe(200);
    expect(aggiornamentiProfilo[0]).toMatchObject({ approval_status: 'approved', is_approved: true });
  });
});
