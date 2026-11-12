/**
 * R06-008 (12/11/2026) — IL TETTO DI DIECI SECONDI ERA DIVENTATO QUELLO DI SERIE.
 *
 * `chiediConTettoSuScritturaDiSessione` senza `ms` aspettava dieci secondi,
 * anche su una lettura, mentre il commento di TETTO_RINNOVO_MS dice che «per
 * tutti gli altri il tetto resta quello di tre secondi». Il prossimo chiamante
 * senza `ms` avrebbe tenuto appesa una pagina dieci secondi.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { chiediConTettoSuScritturaDiSessione, creaRaccoglitoreCookie } from '@/lib/auth/cookie-di-sessione';
import { TETTO_PORTIERE_MS } from '@/lib/auth/decisione-portiere';

afterEach(() => { vi.useRealTimers(); });

describe('R06-008 · il tetto di serie e\' quello di una lettura', () => {
  it('senza `ms` si smette di aspettare dopo tre secondi, non dieci', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const raccoglitore = creaRaccoglitoreCookie();
    const inCorso = chiediConTettoSuScritturaDiSessione(() => new Promise<never>(() => {}), raccoglitore);
    let finito = false;
    void inCorso.then(() => { finito = true; });
    await vi.advanceTimersByTimeAsync(TETTO_PORTIERE_MS + 50);
    expect(finito, 'Senza `ms` la chiamata aspettava ancora: il tetto di serie era di dieci secondi').toBe(true);
    const esito = await inCorso;
    expect(esito.risposta.stato).toBe('scaduto');
  });
});
