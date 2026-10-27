import { describe, it, expect, vi, beforeEach } from 'vitest';
import { databaseCheConosceLeColonne } from './aiuti/database-che-conosce-le-colonne';

/**
 * 26/10/2026 — IL CONTROLLO D'IDENTITÀ DICEVA «PROFILO NON TROVATO» A CHI IL PROFILO CE L'HA.
 *
 * `/api/kyc/start-check` leggeva il profilo chiedendo anche `email`. In `profiles` quella colonna
 * non esiste (l'email sta in `auth.users`, e la rotta la prende già da `user.email`): PostgREST
 * risponde 42703 a tutta la domanda, la rotta riceveva `profile = null` e rispondeva 404 «Profilo
 * non trovato». Il venditore o il fattorino che avviava la verifica si fermava al primo passo.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────────────────────
 * ① ESEGUE la rotta vera contro un database che conosce le colonne vere (dai tipi generati dalle
 *    migrazioni): il profilo si trova, e la rotta passa ai controlli veri (qui: manca il documento).
 * ② ESEGUE la rotta contro un database che scade: deve dire che c'è un guasto, non «Profilo non
 *    trovato» — sono due cose diverse e chi le legge deve poterle distinguere.
 *
 * ⚪ Il fornitore del controllo non viene chiamato: la prova si ferma prima, sul documento mancante.
 */

const stato = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.client }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_opzioni: unknown, gestore: (ctx: { user: { id: string; email: string } }) => Promise<Response>) =>
    () =>
      gestore({ user: { id: 'venditore-1', email: 'mario@example.com' } }),
}));

type Rotta = (req: Request) => Promise<Response>;

async function chiama(): Promise<{ status: number; corpo: string }> {
  const { POST } = await import('@/app/api/kyc/start-check/route');
  const res = await (POST as unknown as Rotta)(new Request('http://localhost/api/kyc/start-check', { method: 'POST' }));
  return { status: res.status, corpo: JSON.stringify(await res.json()) };
}

const PROFILO = {
  id: 'venditore-1',
  role: 'seller',
  legal_first_name: 'Mario',
  legal_last_name: 'Rossi',
  legal_fiscal_code: null,
  legal_birth_date: '1980-01-01',
  business_vat_number: null,
  kyc_id_doc_front_url: null,
  kyc_id_doc_back_url: null,
  kyc_selfie_url: null,
  rider_license_url: null,
  rider_insurance_url: null,
};

beforeEach(() => {
  stato.client = null;
});

describe("il controllo d'identità legge il profilo che c'è", () => {
  it('chiede solo colonne che esistono: trova il profilo e passa ai controlli veri', async () => {
    const db = databaseCheConosceLeColonne({ profiles: [PROFILO] });
    stato.client = db;
    const { status, corpo } = await chiama();

    expect(db.errori, 'una colonna che non esiste fa fallire tutta la domanda (42703)').toEqual([]);
    expect(status, `«Profilo non trovato» a chi il profilo ce l'ha: ${corpo}`).not.toBe(404);
    expect(status).toBe(400);
    expect(corpo).toContain("documento d'identita");
  });

  it('se la lettura cade non dice «Profilo non trovato»: dice che c’è un guasto', async () => {
    stato.client = databaseCheConosceLeColonne({ profiles: [PROFILO] }, { cade: true });
    const { status, corpo } = await chiama();

    expect(corpo).not.toContain('Profilo non trovato');
    expect(status).toBeGreaterThanOrEqual(500);
  });

  // ③ Il profilo che davvero non c'è: `.single()` risponde PGRST116, che è un «non trovato», non un
  //    guasto. Deve restare 404 «Profilo non trovato», non un 500 né un «Non trovato» senza soggetto.
  it('se il profilo non c’è davvero resta 404 «Profilo non trovato», non un guasto', async () => {
    stato.client = databaseCheConosceLeColonne({ profiles: [] });
    const { status, corpo } = await chiama();

    expect(status).toBe(404);
    expect(corpo).toContain('Profilo non trovato');
  });
});
