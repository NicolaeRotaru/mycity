import { describe, it, expect, vi } from 'vitest';
import { cancellaAccount } from '@/lib/account/cancellazione';
import { fintoMondo, quandoChiudeLAccount } from './aiuti/finta-cancellazione-account';

/**
 * R03-015 — LA CANCELLAZIONE LEGGEVA UN 404 QUALSIASI COME «ACCOUNT GIÀ CHIUSO».
 *
 * Il servizio di accesso risponde «utente non trovato» (404, codice `user_not_found`) quando
 * l'account l'ha già chiuso un'altra cancellazione partita insieme: quello è un successo. Ma
 * un 404 di un gateway o di un indirizzo sbagliato non dice niente dell'account, che resta
 * aperto: prima passava per «già cancellato», il profilo veniva svuotato e la notte (o il
 * pannello) diceva «fatto». Adesso solo il «utente non trovato» vale «già chiuso».
 */

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => false, getStripe: () => null }));

const UTENTE = '11111111-1111-4111-8111-111111111111';

function mondoCon(errore: Record<string, unknown>) {
  const m = fintoMondo();
  const admin = {
    ...m.admin,
    auth: {
      admin: {
        ...m.admin.auth.admin,
        deleteUser: async () => {
          m.diario.push({ op: 'cancella-account' });
          return { error: errore };
        },
      },
    },
  };
  return { admin, diario: m.diario };
}

/** Il profilo svuotato dopo la chiusura dell'account (il passo ④). */
const profiloSvuotato = (diario: ReturnType<typeof mondoCon>['diario']) => {
  const chiusura = quandoChiudeLAccount(diario);
  return diario.slice(chiusura + 1).some((v) => v.op === 'update' && v.tabella === 'profiles');
};

describe('R03-015 · solo «utente non trovato» vale «account già chiuso»', () => {
  it('un 404 di un gateway (nessun codice, testo generico) è un guasto: non cancellato, profilo intatto', async () => {
    const { admin, diario } = mondoCon({ status: 404, message: 'Not Found' });
    const esito = await cancellaAccount(admin as never, UTENTE);
    expect(esito.ok, 'un 404 qualsiasi è passato per «account già chiuso»').toBe(false);
    expect(esito.giaCancellato).toBeUndefined();
    expect(esito.errore).toMatch(/non è stato cancellato/);
    expect(profiloSvuotato(diario), 'il profilo è stato svuotato con l’account ancora aperto').toBe(false);
  });

  it('un 404 con un codice diverso da user_not_found è un guasto', async () => {
    const { admin } = mondoCon({ status: 404, code: 'not_found', message: 'requested path is invalid' });
    const esito = await cancellaAccount(admin as never, UTENTE);
    expect(esito.ok).toBe(false);
  });

  it('il «utente non trovato» del servizio di accesso resta «già chiuso»', async () => {
    const { admin, diario } = mondoCon({ status: 404, code: 'user_not_found', message: 'User not found' });
    const esito = await cancellaAccount(admin as never, UTENTE);
    expect(esito.ok).toBe(true);
    expect(esito.giaCancellato).toBe(true);
    expect(profiloSvuotato(diario)).toBe(true);
  });

  it('anche senza codice, il 404 col testo «User not found» resta «già chiuso»', async () => {
    const { admin } = mondoCon({ status: 404, message: 'User not found' });
    const esito = await cancellaAccount(admin as never, UTENTE);
    expect(esito.ok).toBe(true);
    expect(esito.giaCancellato).toBe(true);
  });
});
