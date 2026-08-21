import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * La prova che mancava.
 *
 * Il file `disiscrizione-con-un-clic.test.ts` prova sette cose sulla FIRMA del
 * token: che si riconosca, che non si possa manomettere, che non si possa
 * cambiare indirizzo tenendo la firma di un altro. Tutte vere, tutte verdi.
 *
 * Nessuna di quelle sette accendeva la rotta. E la rotta, scritta lo stesso
 * giorno, aveva due difetti che la radiografia del 18/8 ha trovato e che il
 * database di produzione ha confermato:
 *
 *   ① aggiornava `profiles` filtrando su una colonna `email` che quella tabella
 *      non ha (le email stanno in auth.users). PostgREST rispondeva 42703 e il
 *      codice non guardava l'esito: chi cliccava «Cancellami» non veniva tolto
 *      da niente, e la pagina diceva comunque «fatto».
 *   ② costruiva l'indirizzo di ritorno da NEXT_PUBLIC_SITE_URL, che in questo
 *      progetto non esiste: valeva stringa vuota, e Next 15 su un indirizzo
 *      relativo lancia «URL is malformed». La pagina rispondeva errore.
 *
 * Morale che vale oltre questo caso: sette prove sulla parte facile non
 * coprono la parte che gira. Qui si accende la rotta vera.
 */

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({ rpc: rpcMock, from: fromMock })),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { GET } from '@/app/api/unsubscribe/route';
import { firmaDisiscrizione, linkDisiscrizione } from '@/lib/email/unsubscribe';

const TOKEN = firmaDisiscrizione('maria@example.it', 'newsletter');
const chiama = (token: string) => GET(new Request(`https://qualsiasi.test/api/unsubscribe?token=${encodeURIComponent(token)}`));

describe('la rotta che disiscrive davvero', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.mockResolvedValue({ data: { ok: true, newsletter: 1, profilo: 1 }, error: null });
  });

  it('chiede al database di disiscrivere, invece di cercare una colonna che non esiste', async () => {
    await chiama(TOKEN);
    expect(rpcMock).toHaveBeenCalledWith('disiscrivi', {
      p_email: 'maria@example.it',
      p_ambito: 'newsletter',
    });
    // La strada vecchia — .from('profiles').eq('email', ...) — non deve piu' esistere:
    // e' quella che falliva in silenzio.
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('rimanda a un indirizzo assoluto, altrimenti la pagina va in errore', async () => {
    const res = await chiama(TOKEN);
    const dove = res.headers.get('location') ?? '';
    expect(dove.startsWith('http')).toBe(true);
    expect(dove).toContain('disiscrizione=fatta');
  });

  it('non dice «fatto» se non ha spento niente', async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, newsletter: 0, profilo: 0 }, error: null });
    const res = await chiama(TOKEN);
    expect(res.headers.get('location')).toContain('disiscrizione=non-trovato');
  });

  it('non dice «fatto» se il database ha risposto errore', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: '42703 undefined_column' } });
    const res = await chiama(TOKEN);
    expect(res.headers.get('location')).toContain('disiscrizione=non-riuscita');
  });

  it('con un token manomesso non tocca niente', async () => {
    const res = await chiama(`${TOKEN.slice(0, -3)}xyz`);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toContain('disiscrizione=link-non-valido');
  });
});

describe('il link stampato dentro le email', () => {
  it('non punta a un dominio scritto a mano', () => {
    // Prima cadeva su 'https://mycity.it', che non e' il sito vero
    // (il dominio vero e' mycity-marketplace.com): un link di disiscrizione
    // che porta altrove vale come non averlo.
    const link = linkDisiscrizione('maria@example.it', 'marketing');
    expect(link).not.toContain('mycity.it/');
    expect(link.startsWith('http')).toBe(true);
  });
});
