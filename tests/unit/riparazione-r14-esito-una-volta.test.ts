import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * L'ESITO DI UNA SEGNALAZIONE ARRIVA UNA VOLTA PER CANALE.
 *
 * Comunicare due volte rimandava email e notifiche; dopo un errore parziale la pagina chiede di
 * registrare di nuovo la decisione, e ripartivano anche i canali già arrivati. Il database finto
 * tiene `audit_logs` come quello vero: le righe restano fra una chiamata e l'altra.
 */
const email: Array<{ to: string | string[]; text?: string }> = [];
const notifiche: Array<Record<string, unknown>> = [];
let registro: Array<Record<string, unknown>> = [];
let righe: Record<string, Record<string, unknown>> = {};
let emailFallisce = false;
let notificaFalliscePer: string | null = null;
let registroIllegibile = false;
let orologio = 0;

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({
  sendEmail: async (m: { to: string; text?: string }) => {
    if (emailFallisce) return { ok: false, error: 'resend giù' };
    email.push(m);
    return { ok: true, id: `em-${email.length}` };
  },
}));

function filtro(righeDi: () => Array<Record<string, unknown>>) {
  const condizioni: Array<[string, unknown]> = [];
  const q = {
    eq: (c: string, v: unknown) => { condizioni.push([c, v]); return q; },
    then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(
      registroIllegibile
        ? { data: null, error: { message: 'audit_logs non risponde' } }
        : { data: righeDi().filter((r) => condizioni.every(([c, v]) => r[c] === v)), error: null },
    ).then(ok, ko),
  };
  return q;
}

const admin = {
  from: (tabella: string) => {
    if (tabella === 'segnalazioni') {
      return { select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: righe[id] ?? null, error: null }) }) }) };
    }
    if (tabella === 'products') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { seller_id: 'venditore-1' }, error: null }) }) }) };
    }
    if (tabella === 'notifications') {
      return {
        insert: async (r: Record<string, unknown>) => {
          if (r.user_id === notificaFalliscePer) return { error: { message: 'violates check constraint' } };
          notifiche.push(r);
          return { error: null };
        },
      };
    }
    if (tabella === 'audit_logs') {
      return {
        select: () => filtro(() => registro),
        insert: async (r: Record<string, unknown>) => {
          orologio += 1;
          registro.push({ ...r, created_at: new Date(Date.UTC(2026, 10, 22, 10, 0, orologio)).toISOString() });
          return { error: null };
        },
      };
    }
    throw new Error(`tabella inattesa ${tabella}`);
  },
};

const MOTIVAZIONE = 'Il prodotto riporta un marchio non autorizzato, contraffatto.';
const ALTRA_MOTIVAZIONE = 'Il marchio è risultato autorizzato: la licenza è stata mostrata.';

function segnalazione(id: string, extra: Record<string, unknown> = {}) {
  righe[id] = {
    id, tipo: 'prodotto', oggetto_id: 'prod-1', motivo: 'contraffatto',
    segnalante_id: 'utente-1', email_contatto: 'chi@segnala.it',
    stato: 'accolta', esito_motivato: MOTIVAZIONE, ...extra,
  };
}

async function comunica(id: string) {
  const { comunicaEsito } = await import('@/app/api/segnalazioni/esito/comunica');
  return comunicaEsito(admin, id);
}

describe("l'esito di una segnalazione arriva una volta per canale", () => {
  beforeEach(() => {
    email.length = 0;
    notifiche.length = 0;
    registro = [];
    righe = {};
    emailFallisce = false;
    notificaFalliscePer = null;
    registroIllegibile = false;
    orologio = 0;
    segnalazione('seg-1');
  });

  it('comunicare due volte la stessa decisione non rimanda né la mail né le notifiche', async () => {
    const tutto = { ok: true, segnalanteEmail: 'inviata', segnalanteNotifica: 'inviata', venditore: 'inviata' };
    expect(await comunica('seg-1')).toEqual(tutto);
    expect(await comunica('seg-1')).toEqual(tutto);
    expect(email).toHaveLength(1);
    expect(notifiche.map((n) => n.user_id).sort()).toEqual(['utente-1', 'venditore-1']);
  });

  it('dopo un errore parziale il nuovo tentativo rimanda solo il canale che era fallito', async () => {
    notificaFalliscePer = 'venditore-1';
    expect(await comunica('seg-1')).toMatchObject({ ok: true, segnalanteEmail: 'inviata', segnalanteNotifica: 'inviata', venditore: 'fallita' });
    expect(email).toHaveLength(1);
    expect(notifiche.map((n) => n.user_id)).toEqual(['utente-1']);

    // la pagina chiede di registrare di nuovo la stessa decisione: riparte solo il venditore
    notificaFalliscePer = null;
    segnalazione('seg-1', { deciso_at: '2026-11-22T11:00:00Z' });
    expect(await comunica('seg-1')).toEqual({ ok: true, segnalanteEmail: 'inviata', segnalanteNotifica: 'inviata', venditore: 'inviata' });
    expect(email).toHaveLength(1);
    expect(notifiche.map((n) => n.user_id)).toEqual(['utente-1', 'venditore-1']);
  });

  it('la mail fallita riparte al nuovo tentativo, le notifiche già arrivate no', async () => {
    emailFallisce = true;
    expect(await comunica('seg-1')).toMatchObject({ segnalanteEmail: 'fallita', segnalanteNotifica: 'inviata', venditore: 'inviata' });
    emailFallisce = false;
    expect(await comunica('seg-1')).toMatchObject({ segnalanteEmail: 'inviata' });
    expect(email).toHaveLength(1);
    expect(notifiche).toHaveLength(2);
  });

  it('accolta, poi respinta, poi di nuovo accolta: ogni decisione nuova arriva su tutti i canali', async () => {
    await comunica('seg-1');
    segnalazione('seg-1', { stato: 'respinta', esito_motivato: ALTRA_MOTIVAZIONE });
    await comunica('seg-1');
    segnalazione('seg-1');
    await comunica('seg-1');
    expect(email).toHaveLength(3);
    expect(notifiche).toHaveLength(6);
    expect(String(email[2].text)).toContain(MOTIVAZIONE);
  });

  it('due segnalazioni con la stessa motivazione hanno ognuna il suo esito', async () => {
    segnalazione('seg-2');
    await comunica('seg-1');
    await comunica('seg-2');
    expect(email).toHaveLength(2);
    expect(notifiche).toHaveLength(4);
  });

  it('se la memoria dei canali non si legge, l esito parte comunque', async () => {
    await comunica('seg-1');
    registroIllegibile = true;
    expect(await comunica('seg-1')).toMatchObject({ ok: true, segnalanteEmail: 'inviata', venditore: 'inviata' });
    expect(email).toHaveLength(2);
  });
});
