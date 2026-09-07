import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 6/9/2026 — CHI CANCELLAVA L'ACCOUNT RESTAVA CLIENTE SU STRIPE, E NESSUNO
 * SAPEVA PIÙ QUALE.
 *
 * Il fornaio attiva l'abbonamento a giugno: su Stripe nasce un cliente con
 * nome, email, indirizzo di fatturazione e lo storico dei pagamenti. A
 * settembre chiede di cancellare l'account. La pipeline svuotava il profilo e
 * cancellava l'utente — e con la riga del profilo spariva
 * `stripe_customer_id`, cioè l'unico filo che collegava noi a quel cliente.
 *
 * Su Stripe non lo cancellava nessuno. Restavano i suoi dati, sotto un
 * codice che noi non conoscevamo più: se il giorno dopo ci avesse scritto
 * «cancellate anche là», non avremmo avuto modo di trovarlo. Un buco che
 * nemmeno volendo si poteva più chiudere.
 *
 * LA REGOLA È QUESTA: prima si propaga la cancellazione a chi ha una copia,
 * poi si fa il passo irreversibile. Se la propagazione non riesce, l'account
 * NON si cancella e la richiesta resta in coda per la notte dopo — meglio un
 * giorno di ritardo che un dato che non si può più raggiungere.
 */

const stripe = {
  cancellati: [] as string[],
  errore: null as { message: string; code?: string } | null,
  configurato: true,
};

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => stripe.configurato,
  getStripe: () => ({
    customers: {
      del: async (id: string) => {
        if (stripe.errore) throw Object.assign(new Error(stripe.errore.message), { code: stripe.errore.code });
        stripe.cancellati.push(id);
        return { id, deleted: true };
      },
    },
  }),
}));

import { cancellaAccount } from '@/lib/account/cancellazione';

const UTENTE = '11111111-1111-4111-8111-111111111111';

/** Il finto mondo: come quello condiviso, ma il profilo ha un cliente Stripe. */
function fintoMondo(opzioni: { clienteStripe?: string | null; erroreLettura?: string } = {}) {
  const diario: string[] = [];
  const admin = {
    from(tabella: string) {
      return {
        select(_colonne: string) {
          return {
            eq: async (_c: string, _v: string) => {
              diario.push(`select:${tabella}`);
              if (tabella === 'profiles') {
                if (opzioni.erroreLettura) return { data: null, error: { message: opzioni.erroreLettura } };
                return { data: [{ stripe_customer_id: opzioni.clienteStripe ?? null }], error: null };
              }
              return { data: [], error: null };
            },
          };
        },
        update(_valori: Record<string, unknown>) {
          return {
            eq: async () => {
              diario.push(`update:${tabella}`);
              return { error: null };
            },
          };
        },
        delete() {
          return { ilike: async () => ({ error: null }) };
        },
      };
    },
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: 'fornaio@example.it' } } }),
        deleteUser: async () => {
          diario.push('cancella-account');
          return { error: null };
        },
      },
    },
    storage: {
      from: () => ({ list: async () => ({ data: [], error: null }), remove: async () => ({ error: null }) }),
    },
  };
  return { admin, diario };
}

beforeEach(() => {
  stripe.cancellati = [];
  stripe.errore = null;
  stripe.configurato = true;
});

describe('quando si cancella un account che su Stripe è un cliente', () => {
  it('il cliente viene cancellato anche là, prima del passo irreversibile', async () => {
    const { admin, diario } = fintoMondo({ clienteStripe: 'cus_fornaio' });

    const esito = await cancellaAccount(admin as never, UTENTE);

    expect(esito.ok).toBe(true);
    expect(
      stripe.cancellati,
      'i dati restano su Stripe sotto un codice che dopo non conosciamo più',
    ).toEqual(['cus_fornaio']);
  });

  it('se Stripe non risponde, l account NON si cancella: la richiesta resta in coda', async () => {
    stripe.errore = { message: 'connessione interrotta' };
    const { admin, diario } = fintoMondo({ clienteStripe: 'cus_fornaio' });

    const esito = await cancellaAccount(admin as never, UTENTE);

    expect(esito.ok).toBe(false);
    expect(
      diario.includes('cancella-account'),
      'l account è sparito mentre i suoi dati restavano su Stripe, e il codice per trovarli con lui',
    ).toBe(false);
    expect(esito.errore).toContain('Stripe');
  });

  it('un cliente che su Stripe non esiste più non blocca niente', async () => {
    stripe.errore = { message: 'No such customer', code: 'resource_missing' };
    const { admin, diario } = fintoMondo({ clienteStripe: 'cus_sparito' });

    const esito = await cancellaAccount(admin as never, UTENTE);

    expect(esito.ok).toBe(true);
    expect(diario.includes('cancella-account')).toBe(true);
  });

  it('chi non ha mai pagato non passa nemmeno da Stripe', async () => {
    const { admin, diario } = fintoMondo({ clienteStripe: null });

    const esito = await cancellaAccount(admin as never, UTENTE);

    expect(esito.ok).toBe(true);
    expect(stripe.cancellati).toEqual([]);
    expect(diario.includes('cancella-account')).toBe(true);
  });

  it('se il codice del cliente non si riesce a leggere, non si va avanti al buio', async () => {
    const { admin, diario } = fintoMondo({ erroreLettura: 'database non raggiungibile' });

    const esito = await cancellaAccount(admin as never, UTENTE);

    expect(esito.ok).toBe(false);
    expect(diario.includes('cancella-account')).toBe(false);
  });
});
