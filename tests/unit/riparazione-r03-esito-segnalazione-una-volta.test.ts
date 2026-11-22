import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R03-012 R03-013 — L'esito di una segnalazione non si rimanda: comunicarlo due volte, o riprovare
 * dopo un errore parziale, non rispedisce la mail e le notifiche già arrivate. Posta e database finti;
 * la posta finta fa come Resend: la stessa chiave di idempotenza non spedisce due volte.
 */
type Riga = Record<string, unknown>;
const consegnate: Array<{ to: unknown; chiave: string | undefined }> = [];
const chiaviViste = new Set<string>();
let notifiche: Riga[] = [];
let rifiutaPer: string | null = null;
const riga: Riga = {
  id: 'seg-1', tipo: 'prodotto', oggetto_id: 'prod-1', motivo: 'contraffatto',
  segnalante_id: 'utente-1', email_contatto: 'chi@segnala.it',
  stato: 'accolta', esito_motivato: 'Il prodotto riporta un marchio non autorizzato e contraffatto.',
};

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({
  sendEmail: async (m: { to: unknown; idempotencyKey?: string }) => {
    if (m.idempotencyKey && chiaviViste.has(m.idempotencyKey)) return { ok: true, id: '' };
    if (m.idempotencyKey) chiaviViste.add(m.idempotencyKey);
    consegnate.push({ to: m.to, chiave: m.idempotencyKey });
    return { ok: true, id: 'em-1' };
  },
}));

const admin = {
  from: (tabella: string) => {
    if (tabella === 'segnalazioni') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: riga, error: null }) }) }) };
    if (tabella === 'products') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { seller_id: 'venditore-1' }, error: null }) }) }) };
    if (tabella === 'notifications') {
      return {
        select: () => {
          const filtri: Array<[string, unknown]> = [];
          const q: Record<string, unknown> = {
            eq: (c: string, v: unknown) => (filtri.push([c, v]), q),
            is: (c: string, v: unknown) => (filtri.push([c, v]), q),
            limit: async () => ({ data: notifiche.filter((n) => filtri.every(([c, v]) => n[c] === v)).map((n) => ({ id: n.id })), error: null }),
          };
          return q;
        },
        insert: async (r: Riga) => {
          if (rifiutaPer === r.user_id) return { error: { message: 'giù' } };
          notifiche.push({ id: `n-${notifiche.length}`, ...r });
          return { error: null };
        },
      };
    }
    throw new Error(`tabella inattesa ${tabella}`);
  },
};

beforeEach(() => {
  consegnate.length = 0;
  chiaviViste.clear();
  notifiche = [];
  rifiutaPer = null;
});

describe('R03-012 R03-013 — l’esito arriva una volta sola', () => {
  it('comunicato due volte: una mail, due notifiche (non quattro)', async () => {
    const { comunicaEsito } = await import('@/app/api/segnalazioni/esito/comunica');
    const a = await comunicaEsito(admin, 'seg-1');
    const b = await comunicaEsito(admin, 'seg-1');
    expect(a).toEqual({ ok: true, segnalanteEmail: 'inviata', segnalanteNotifica: 'inviata', venditore: 'inviata' });
    expect(b).toEqual(a);
    expect(consegnate, 'la mail è stata rimandata').toHaveLength(1);
    expect(notifiche, 'le notifiche sono state riscritte').toHaveLength(2);
  });

  it('errore parziale (notifica al venditore rifiutata) e nuovo tentativo: arriva solo quello che mancava', async () => {
    const { comunicaEsito } = await import('@/app/api/segnalazioni/esito/comunica');
    rifiutaPer = 'venditore-1';
    const primo = await comunicaEsito(admin, 'seg-1');
    expect(primo).toMatchObject({ ok: true, venditore: 'fallita', segnalanteEmail: 'inviata', segnalanteNotifica: 'inviata' });
    rifiutaPer = null;
    const secondo = await comunicaEsito(admin, 'seg-1');
    expect(secondo).toEqual({ ok: true, segnalanteEmail: 'inviata', segnalanteNotifica: 'inviata', venditore: 'inviata' });
    expect(consegnate).toHaveLength(1);
    expect(notifiche.map((n) => n.user_id).sort()).toEqual(['utente-1', 'venditore-1']);
  });

  it('una motivazione cambiata è un esito nuovo: mail e notifiche ripartono', async () => {
    const { comunicaEsito } = await import('@/app/api/segnalazioni/esito/comunica');
    await comunicaEsito(admin, 'seg-1');
    riga.esito_motivato = 'Dopo un secondo controllo il marchio risulta autorizzato dal titolare.';
    riga.stato = 'respinta';
    await comunicaEsito(admin, 'seg-1');
    expect(consegnate).toHaveLength(2);
    expect(notifiche).toHaveLength(4);
  });
});
