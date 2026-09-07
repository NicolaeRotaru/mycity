import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

/**
 * 6/9/2026 — IL BONIFICO CHE TORNAVA INDIETRO LO SCOPRIVA SOLO L'AMMINISTRATORE,
 * E SENZA SAPERE DI CHI ERA.
 *
 * Pane Quotidiano cambia IBAN e dimentica di aggiornarlo su Stripe. Il
 * versamento di 120 € rimbalza. Stripe manda `payout.failed`, e il codice
 * scriveva un avviso agli amministratori con dentro il codice del bonifico
 * (`po_1abc`) e l'importo: non il nome del negozio. Per sapere chi fosse
 * bisognava aprire Stripe a mano.
 *
 * E il negoziante non veniva avvisato da nessuno: nella sua pagina Guadagni
 * leggeva «versato», in banca non trovava niente, e se ne accorgeva lui giorni
 * dopo.
 *
 * Queste prove diventano rosse se l'avviso torna anonimo o se il negozio
 * smette di essere avvisato.
 */

type Notifica = { user_id: string; title: string; body: string; category?: string; link?: string };

const mondo: { profili: Array<Record<string, unknown>>; notifiche: Notifica[] } = {
  profili: [],
  notifiche: [],
};

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/stripe/payout', () => ({ applyConnectAccountStatus: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => ({
      select: (_c: string) => ({
        eq: (colonna: string, valore: string) => {
          const righe = mondo.profili.filter((p) => p[colonna] === valore);
          const risposta = { data: righe, error: null };
          return Object.assign(Promise.resolve(risposta), {
            limit: async () => risposta,
          });
        },
      }),
      insert: async (riga: Notifica | Notifica[]) => {
        if (tabella === 'notifications') {
          for (const n of Array.isArray(riga) ? riga : [riga]) mondo.notifiche.push(n);
        }
        return { error: null };
      },
    }),
  }),
}));

import { handlePayoutFailed } from '@/lib/stripe/webhook/trasferimenti';

const IL_FORNAIO = 'aaaaaaaa-1111-4111-8111-111111111111';

function bonificoRimbalzato() {
  return {
    id: 'po_1abc',
    amount: 12000,
    failure_message: 'Il conto indicato non esiste più (account_closed)',
  } as unknown as Stripe.Payout;
}

beforeEach(() => {
  mondo.profili = [
    { id: 'admin-1', role: 'admin', store_name: null, stripe_account_id: null },
    { id: IL_FORNAIO, role: 'seller', store_name: 'Pane Quotidiano', stripe_account_id: 'acct_fornaio' },
  ];
  mondo.notifiche = [];
});

describe('quando la banca rifiuta il bonifico di un negozio', () => {
  it('il negoziante lo viene a sapere, con il motivo e dove correggere', async () => {
    await handlePayoutFailed(bonificoRimbalzato(), 'acct_fornaio');

    const alNegozio = mondo.notifiche.find((n) => n.user_id === IL_FORNAIO);
    expect(
      alNegozio,
      'il negoziante non è stato avvisato: legge «versato» nei Guadagni e in banca non trova niente',
    ).toBeTruthy();
    expect(alNegozio?.body).toContain('120.00');
    expect(alNegozio?.body).toContain('account_closed');
    // Gli avvisi di servizio non si spengono dagli interruttori delle notifiche.
    expect(alNegozio?.category).toBe('system');
  });

  it('l avviso agli amministratori dice di quale negozio si tratta', async () => {
    await handlePayoutFailed(bonificoRimbalzato(), 'acct_fornaio');

    const allAdmin = mondo.notifiche.find((n) => n.user_id === 'admin-1');
    expect(allAdmin, 'nessun avviso agli amministratori').toBeTruthy();
    expect(
      allAdmin?.body,
      'l avviso non nomina il negozio: per capire di chi è bisogna aprire Stripe a mano',
    ).toContain('Pane Quotidiano');
  });

  it('se il conto non si riconosce lo dice, invece di far finta di niente', async () => {
    await handlePayoutFailed(bonificoRimbalzato(), 'acct_sconosciuto');

    expect(mondo.notifiche.filter((n) => n.user_id === IL_FORNAIO)).toHaveLength(0);
    const allAdmin = mondo.notifiche.find((n) => n.user_id === 'admin-1');
    expect(allAdmin?.body).toContain('po_1abc');
    expect(allAdmin?.body.toLowerCase()).toContain('non riconosciuto');
  });
});
