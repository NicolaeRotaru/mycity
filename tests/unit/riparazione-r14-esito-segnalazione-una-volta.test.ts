import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R14-021 — comunicare due volte l'esito di una segnalazione non rimanda mail e notifiche, e dopo
 * un errore il nuovo tentativo rimanda solo i canali che non erano riusciti. Due chiamate partite
 * insieme spediscono una volta sola.
 *
 * Il finto database tiene le tre colonne della migrazione 385 e applica l'UPDATE condizionato
 * (`... eq id ... is colonna null`) in un colpo solo, come il vero.
 */
type Riga = Record<string, unknown>;
const email: Array<{ to: unknown }> = [];
const notifiche: Array<Riga> = [];
let seg: Riga;
let emailRiesce = true;
let notificaVenditoreRiesce = true;

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({
  sendEmail: async (m: { to: unknown }) => {
    await Promise.resolve();
    if (!emailRiesce) return { ok: false, error: 'giù' };
    email.push(m);
    return { ok: true, id: 'em' };
  },
}));

function updateSeg(valori: Riga) {
  const cond: Array<() => boolean> = [];
  const b: Record<string, unknown> = {
    eq: (c: string, v: unknown) => { cond.push(() => seg[c] === v); return b; },
    is: (c: string, v: unknown) => { cond.push(() => (seg[c] ?? null) === v); return b; },
    select: () => b,
    then: (ok: (r: unknown) => unknown) => {
      const passa = cond.every((f) => f());
      if (passa) Object.assign(seg, valori);
      return Promise.resolve({ data: passa ? [{ id: seg.id }] : [], error: null }).then(ok);
    },
  };
  return b;
}

const admin = {
  from: (t: string) => {
    if (t === 'segnalazioni') {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ...seg }, error: null }) }) }),
        update: (v: Riga) => updateSeg(v),
      };
    }
    if (t === 'products') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { seller_id: 'venditore-1' }, error: null }) }) }) };
    }
    if (t === 'notifications') {
      return {
        insert: async (r: Riga) => {
          await Promise.resolve();
          if (r.user_id === 'venditore-1' && !notificaVenditoreRiesce) return { error: { message: 'rifiutata' } };
          notifiche.push(r);
          return { error: null };
        },
      };
    }
    throw new Error(`tabella inattesa ${t}`);
  },
};

const MOTIVAZIONE = 'Il prodotto riporta un marchio non autorizzato e contraffatto.';

beforeEach(() => {
  email.length = 0;
  notifiche.length = 0;
  emailRiesce = true;
  notificaVenditoreRiesce = true;
  seg = {
    id: 'seg-1', tipo: 'prodotto', oggetto_id: 'prod-1', motivo: 'contraffatto',
    segnalante_id: 'utente-1', email_contatto: 'chi@segnala.it',
    stato: 'accolta', esito_motivato: MOTIVAZIONE,
    esito_email_at: null, esito_notifica_at: null, esito_venditore_at: null,
  };
});

describe('R14-021 un esito si comunica una volta per canale', () => {
  it('la seconda comunicazione non rimanda mail e notifiche', async () => {
    const { comunicaEsito } = await import('@/app/api/segnalazioni/esito/comunica');
    await comunicaEsito(admin, 'seg-1');
    const r = await comunicaEsito(admin, 'seg-1');
    expect(r).toEqual({ ok: true, segnalanteEmail: 'inviata', segnalanteNotifica: 'inviata', venditore: 'inviata' });
    expect(email).toHaveLength(1);
    expect(notifiche).toHaveLength(2);
  });

  it('dopo un errore il nuovo tentativo rimanda solo il canale non riuscito', async () => {
    const { comunicaEsito } = await import('@/app/api/segnalazioni/esito/comunica');
    notificaVenditoreRiesce = false;
    const primo = await comunicaEsito(admin, 'seg-1');
    expect(primo).toMatchObject({ ok: true, segnalanteEmail: 'inviata', segnalanteNotifica: 'inviata', venditore: 'fallita' });
    notificaVenditoreRiesce = true;
    const secondo = await comunicaEsito(admin, 'seg-1');
    expect(secondo).toMatchObject({ ok: true, venditore: 'inviata' });
    expect(email).toHaveLength(1);
    expect(notifiche.map((n) => n.user_id).sort()).toEqual(['utente-1', 'venditore-1']);
  });

  it('una mail non partita si rifà al nuovo tentativo, senza rifare la notifica', async () => {
    const { comunicaEsito } = await import('@/app/api/segnalazioni/esito/comunica');
    emailRiesce = false;
    expect(await comunicaEsito(admin, 'seg-1')).toMatchObject({ segnalanteEmail: 'fallita', segnalanteNotifica: 'inviata' });
    emailRiesce = true;
    expect(await comunicaEsito(admin, 'seg-1')).toMatchObject({ segnalanteEmail: 'inviata' });
    expect(email).toHaveLength(1);
    expect(notifiche.filter((n) => n.user_id === 'utente-1')).toHaveLength(1);
  });

  it('due chiamate partite insieme spediscono una volta sola', async () => {
    const { comunicaEsito } = await import('@/app/api/segnalazioni/esito/comunica');
    await Promise.all([comunicaEsito(admin, 'seg-1'), comunicaEsito(admin, 'seg-1')]);
    expect(email).toHaveLength(1);
    expect(notifiche).toHaveLength(2);
  });
});
