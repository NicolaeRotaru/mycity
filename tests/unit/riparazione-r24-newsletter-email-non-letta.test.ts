/**
 * R24-015 — SE LA LETTURA DELL'EMAIL CADE, LA CANCELLAZIONE LASCIAVA L'INDIRIZZO NELLA NEWSLETTER.
 *
 * `togliDallaNewsletter` prendeva solo `data` da `getUserById`: con la lettura caduta l'email valeva
 * null, la funzione usciva come per un utente senza email, senza una riga nel registro, e poi
 * l'account si cancellava. L'iscrizione vive per indirizzo email: dopo la cancellazione non la ritrova
 * più nessuno. Adesso la pulizia non riuscita ferma la cancellazione prima del passo irreversibile,
 * lo si scrive nel registro e la notte dopo si riprova.
 *
 * Supabase finto, in memoria (nessun database vero); Stripe finto e spento.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';

const registro = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), spesa: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => ({}) }));
vi.mock('@/lib/logger', () => ({ logger: registro }));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => false,
  getStripe: () => {
    throw new Error('Stripe vero: mai nelle prove');
  },
}));

import { cancellaAccount } from '@/lib/account/cancellazione';

const ID = '00000000-0000-4000-8000-000000000041';
const EMAIL = 'maria@example.test';

function unAccount(getUserById: (id: string) => Promise<unknown>) {
  const giro = fintoGiroNotturno({
    tabelle: {
      profiles: [{ id: ID, role: 'buyer' }],
      newsletter_subscribers: [{ id: 'n1', email: EMAIL }],
      cod_reconciliations: [],
      orders: [],
      audit_logs: [],
    },
  });
  const deleteUser = vi.fn(async () => ({ error: null }));
  const auth = (giro.admin as unknown as { auth: { admin: Record<string, unknown> } }).auth.admin;
  auth.deleteUser = deleteUser;
  auth.getUserById = getUserById;
  return { giro, deleteUser };
}

beforeEach(() => {
  for (const f of Object.values(registro)) f.mockClear();
});

describe('R24-015 · la lettura dell’email caduta non lascia l’indirizzo nella newsletter', () => {
  it('getUserById risponde con un errore: l’account non si cancella, l’iscrizione resta ritrovabile e il registro lo dice', async () => {
    const { giro, deleteUser } = unAccount(async () => ({ data: { user: null }, error: { message: 'rete caduta' } }));

    const esito = await cancellaAccount(giro.admin as never, ID);

    expect(deleteUser, 'l’account si è cancellato con l’indirizzo ancora iscritto alla newsletter').not.toHaveBeenCalled();
    expect(esito.ok).toBe(false);
    expect(esito.motivo, 'è un guasto, non un rinvio deciso da noi: la notte deve svegliare qualcuno').toBeUndefined();
    expect(String(esito.errore)).toContain('newsletter');
    expect(giro.righe('newsletter_subscribers')).toHaveLength(1);
    const scritto = [...registro.error.mock.calls, ...registro.warn.mock.calls].map((c) => JSON.stringify(c)).join(' ');
    expect(scritto, 'la lettura caduta non ha lasciato traccia nel registro').toContain('rete caduta');
  });

  it('getUserById lancia: stessa cosa, l’account resta e si riprova', async () => {
    const { giro, deleteUser } = unAccount(async () => {
      throw new Error('timeout');
    });

    const esito = await cancellaAccount(giro.admin as never, ID);

    expect(deleteUser).not.toHaveBeenCalled();
    expect(esito.ok).toBe(false);
  });

  it('la lettura riesce: l’iscrizione si toglie e l’account si cancella, come prima', async () => {
    const { giro, deleteUser } = unAccount(async (id: string) => ({ data: { user: { id, email: EMAIL } }, error: null }));

    const esito = await cancellaAccount(giro.admin as never, ID);

    expect(esito.ok).toBe(true);
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(giro.righe('newsletter_subscribers')).toHaveLength(0);
  });

  it('un utente senza email (nessun errore): niente da togliere, la cancellazione va avanti', async () => {
    const { giro, deleteUser } = unAccount(async () => ({ data: { user: { id: ID, email: null } }, error: null }));

    const esito = await cancellaAccount(giro.admin as never, ID);

    expect(esito.ok).toBe(true);
    expect(deleteUser).toHaveBeenCalledTimes(1);
  });

  it('l’utente di accesso è già cancellato (404 user_not_found): niente da togliere, la cancellazione non resta bloccata', async () => {
    const nonTrovato = { message: 'User not found', status: 404, code: 'user_not_found' };
    const { giro, deleteUser } = unAccount(async () => ({ data: { user: null }, error: nonTrovato }));
    deleteUser.mockImplementation(async () => ({ error: nonTrovato }) as never);

    const esito = await cancellaAccount(giro.admin as never, ID);

    expect(esito.ok, 'un account già tolto dal servizio di accesso resterebbe in coda per sempre').toBe(true);
    expect(deleteUser).toHaveBeenCalledTimes(1);
  });
});
