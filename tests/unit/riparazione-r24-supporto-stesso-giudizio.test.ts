import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 13/11/2026 (R24-010) — IL MODULO CONTATTI E LA PORTA «CANCELLA ACCOUNT» GIUDICANO
 * SUPPORT_EMAIL ALLO STESSO MODO.
 *
 * La porta (lib/legal/titolare.ts, `ilModuloArrivaSenzaDatabase`) pretende la casella
 * del supporto sul dominio dei contatti; il modulo, senza database, inoltrava a
 * qualunque indirizzo e rispondeva «ok». Con la casella dell'esempio
 * (support@mycity.it, un dominio non nostro) la porta diceva «nessun canale» e il
 * modulo diceva «arrivato» a chi aveva scritto, con un messaggio che non leggeva
 * nessuno. Qui le due risposte devono coincidere.
 */

const spedite: unknown[] = [];
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => {
    throw new Error('manca la chiave di servizio');
  }),
  getCurrentUser: vi.fn(async () => null),
}));
vi.mock('@/lib/email/client', () => ({
  sendEmail: vi.fn(async (m: unknown) => {
    spedite.push(m);
    return { ok: true };
  }),
}));

import { POST } from '@/app/api/contact/route';
import { ilModuloArrivaSenzaDatabase } from '@/lib/legal/titolare';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const DOMINIO = 'mycity-marketplace.com';
const scrive = (ip: string) =>
  POST(
    new Request('http://localhost/api/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ name: 'Mario Rossi', email: 'mario@example.com', subject: 'Privacy', message: 'Vorrei cancellare i miei dati.' }),
    }),
  );

beforeEach(() => {
  __resetRateLimitBuckets();
  spedite.length = 0;
  process.env.NEXT_PUBLIC_CONTATTI_DOMINIO = DOMINIO;
  // Valori finti: la posta qui non parte mai (sendEmail è sostituito).
  process.env.RESEND_API_KEY = 're_finta_solo_per_la_prova';
  process.env.RESEND_FROM = `MyCity <no-reply@${DOMINIO}>`;
});

describe('una casella sola, un giudizio solo', () => {
  it('IL CASO CHE ROMPEVA — casella fuori dominio: la porta dice «nessun canale» e il modulo non dice «arrivato»', async () => {
    process.env.SUPPORT_EMAIL = 'support@mycity.it';
    expect(ilModuloArrivaSenzaDatabase()).toBe(false);
    const r = await scrive('8.0.0.1');
    expect(spedite, 'il modulo ha inoltrato a una casella che la porta giudica morta').toHaveLength(0);
    expect(r.status).toBe(503);
  });

  it('casella sul dominio dei contatti: tutti e due dicono che arriva', async () => {
    process.env.SUPPORT_EMAIL = `assistenza@${DOMINIO}`;
    expect(ilModuloArrivaSenzaDatabase()).toBe(true);
    const r = await scrive('8.0.0.2');
    expect(r.status).toBe(200);
    expect(spedite).toHaveLength(1);
  });

  it.each(['support@mycity.it', `assistenza@${DOMINIO}`, `aiuto@posta.${DOMINIO}`, 'qualcuno@gmail.com'])(
    'con SUPPORT_EMAIL=%s il modulo inoltra solo se la porta dice che arriva',
    async (casella) => {
      process.env.SUPPORT_EMAIL = casella;
      const r = await scrive(`8.0.1.${casella.length}`);
      expect(r.status === 200).toBe(ilModuloArrivaSenzaDatabase());
      expect(spedite.length === 1).toBe(ilModuloArrivaSenzaDatabase());
    },
  );
});
