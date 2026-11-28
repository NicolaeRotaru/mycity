/**
 * R08-013 — LA CANCELLAZIONE DELL'ACCOUNT NON RIPULIVA LE SEGNALAZIONI FATTE DA QUELL'ACCOUNT.
 *
 * `segnalazioni.segnalante_id` punta all'utente con ON DELETE SET NULL (migrations/126): la riga
 * della segnalazione resta, ed è giusto (dice cosa è stato segnalato e com'è finita). Ma restavano
 * anche l'email di contatto e il testo scritto da chi aveva chiesto di sparire, senza più il filo
 * che li riporta a lui.
 *
 * Supabase finto, in memoria (nessun database vero); Stripe finto e spento.
 */
import { describe, expect, it, vi } from 'vitest';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => ({}) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => false,
  getStripe: () => {
    throw new Error('Stripe vero: mai nelle prove');
  },
}));

import { cancellaAccount } from '@/lib/account/cancellazione';

const ID = '00000000-0000-4000-8000-000000000813';
const ALTRA = '00000000-0000-4000-8000-000000000814';

describe('R08-013 · le segnalazioni restano, i dati di chi se ne va no', () => {
  it('email di contatto e testo si azzerano prima di chiudere l’account; la segnalazione e quelle degli altri restano', async () => {
    const giro = fintoGiroNotturno({
      tabelle: {
        profiles: [{ id: ID, role: 'buyer' }],
        cod_reconciliations: [],
        orders: [],
        segnalazioni: [
          {
            id: 's1', tipo: 'prodotto', oggetto_id: 'p1', motivo: 'pericoloso', stato: 'accolta',
            segnalante_id: ID, email_contatto: 'maria@example.test', dettaglio: 'Sono Maria Rossi, il prodotto mi ha ustionato',
          },
          {
            id: 's2', tipo: 'negozio', oggetto_id: 'n1', motivo: 'altro', stato: 'ricevuta',
            segnalante_id: ALTRA, email_contatto: 'luca@example.test', dettaglio: 'testo di Luca',
          },
        ],
      },
    });

    const esito = await cancellaAccount(giro.admin as never, ID);

    expect(esito.ok).toBe(true);
    const [sua, altrui] = giro.righe('segnalazioni');
    expect(giro.righe('segnalazioni')).toHaveLength(2);
    expect(sua.email_contatto, 'l’email di chi ha cancellato l’account resta nella sua segnalazione').toBeNull();
    expect(sua.dettaglio, 'il testo di chi ha cancellato l’account resta nella sua segnalazione').toBeNull();
    expect(sua).toMatchObject({ tipo: 'prodotto', oggetto_id: 'p1', motivo: 'pericoloso', stato: 'accolta' });
    expect(altrui).toMatchObject({ email_contatto: 'luca@example.test', dettaglio: 'testo di Luca' });
  });
});
