import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * L'ESITO DI UNA SEGNALAZIONE ARRIVA A CHI HA SEGNALATO E AL VENDITORE.
 *
 * 1/11/2026 — La pagina /admin/segnalazioni salvava decisione e motivazione,
 * ma nessun codice le comunicava: né a chi aveva segnalato (DSA art. 16.5) né
 * al venditore toccato dalla decisione (art. 17). Questa prova esegue il
 * mittente con un database finto che, come quello vero, restituisce gli
 * errori invece di sollevarli.
 */
const email: Array<{ to: string | string[]; html: string; text?: string }> = [];
const notifiche: Array<Record<string, unknown>> = [];
let riga: Record<string, unknown> | null;
let erroreNotifiche: { message: string } | null = null;

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({
  sendEmail: async (m: { to: string; html: string; text?: string }) => { email.push(m); return { ok: true, id: 'em-1' }; },
}));

const admin = {
  from: (tabella: string) => {
    if (tabella === 'segnalazioni') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: riga, error: null }) }) }) };
    }
    if (tabella === 'products') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { seller_id: 'venditore-1' }, error: null }) }) }) };
    }
    if (tabella === 'notifications') {
      return { insert: async (r: Record<string, unknown>) => { if (!erroreNotifiche) notifiche.push(r); return { error: erroreNotifiche }; } };
    }
    throw new Error(`tabella inattesa ${tabella}`);
  },
};

const MOTIVAZIONE = 'Il prodotto riporta un marchio non autorizzato <b>contraffatto</b>.';

describe('comunicaEsito', () => {
  beforeEach(() => {
    email.length = 0;
    notifiche.length = 0;
    erroreNotifiche = null;
    riga = {
      id: 'seg-1', tipo: 'prodotto', oggetto_id: 'prod-1', motivo: 'contraffatto',
      segnalante_id: 'utente-1', email_contatto: 'chi@segnala.it',
      stato: 'accolta', esito_motivato: MOTIVAZIONE,
    };
  });

  it('manda la motivazione per email a chi ha segnalato e in notifica a lui e al venditore', async () => {
    const { comunicaEsito } = await import('@/app/api/segnalazioni/esito/comunica');
    const r = await comunicaEsito(admin, 'seg-1');
    expect(r).toEqual({ ok: true, segnalanteEmail: 'inviata', segnalanteNotifica: 'inviata', venditore: 'inviata' });
    expect(email).toHaveLength(1);
    expect(email[0].to).toBe('chi@segnala.it');
    expect(email[0].text).toContain(MOTIVAZIONE);
    expect(email[0].html).not.toContain('<b>contraffatto</b>'); // il testo dell'admin non entra come HTML
    expect(notifiche.map((n) => n.user_id).sort()).toEqual(['utente-1', 'venditore-1']);
    for (const n of notifiche) {
      expect(n.category).toBe('system');
      expect(String(n.body)).toContain(MOTIVAZIONE);
    }
  });

  it('non manda niente finché la decisione non c è o la motivazione è un «ok»', async () => {
    const { comunicaEsito } = await import('@/app/api/segnalazioni/esito/comunica');
    riga = { ...riga!, stato: 'in_esame' };
    expect(await comunicaEsito(admin, 'seg-1')).toEqual({ ok: false, motivo: 'non_decisa' });
    riga = { ...riga!, stato: 'respinta', esito_motivato: 'ok' };
    expect(await comunicaEsito(admin, 'seg-1')).toEqual({ ok: false, motivo: 'non_decisa' });
    riga = null;
    expect(await comunicaEsito(admin, 'seg-1')).toEqual({ ok: false, motivo: 'non_trovata' });
    expect(email).toHaveLength(0);
    expect(notifiche).toHaveLength(0);
  });

  it('una notifica rifiutata dal database torna come fallita, non come inviata', async () => {
    const { comunicaEsito } = await import('@/app/api/segnalazioni/esito/comunica');
    erroreNotifiche = { message: 'violates check constraint' };
    const r = await comunicaEsito(admin, 'seg-1');
    expect(r).toMatchObject({ ok: true, segnalanteNotifica: 'fallita', venditore: 'fallita' });
  });
});
