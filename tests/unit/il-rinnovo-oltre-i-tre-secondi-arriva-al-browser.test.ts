import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextResponse } from 'next/server';

import { TETTO_PORTIERE_MS } from '@/lib/auth/decisione-portiere';
import {
  TETTO_RINNOVO_MS,
  chiediConTettoSuScritturaDiSessione,
  creaRaccoglitoreCookie,
  tettoPerChiedereChiSei,
  travasaCookie,
} from '@/lib/auth/cookie-di-sessione';

/**
 * Ondata 8 — IL TETTO DEI TRE SECONDI NON DEVE BRUCIARE LA SESSIONE.
 *
 * Se `auth.getUser()` decide di rinnovare la tessera dopo 3,5 secondi, la
 * tessera nuova deve arrivare sulla risposta. Se il portiere ha già smesso di
 * aspettare a 3 secondi, il server ha bruciato la vecchia e il browser non
 * riceve la nuova: il cliente viene buttato fuori al click successivo.
 *
 * Se `getUser()` scriverà la sessione lo decide la libreria, con le sue regole
 * e il suo orologio. Il portiere può solo indovinarlo. Quindi chi ha una
 * tessera in tasca ha il tetto lungo. Il tetto corto vale solo per chi non ne
 * ha nessuna, perché lì non c'è niente da rinnovare.
 */

const NOME = 'sb-progetto-auth-token';
const OPZIONI = { path: '/', httpOnly: true, sameSite: 'lax' as const };

function cookieSessione(scadeFraSecondi: number): string {
  const sessione = {
    access_token: 'a',
    refresh_token: 'r',
    expires_at: Math.floor(Date.now() / 1000) + scadeFraSecondi,
  };
  const b64 = btoa(JSON.stringify(sessione)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `base64-${b64}`;
}

function getUserCheRinnovaDopo(ritardo: number, raccoglitore: ReturnType<typeof creaRaccoglitoreCookie>) {
  return () =>
    new Promise<{ data: { user: { id: string } }; error: null }>((risolvi) => {
      setTimeout(() => {
        raccoglitore.set(NOME, 'gettone-nuovo', OPZIONI);
        risolvi({ data: { user: { id: 'u-1' } }, error: null });
      }, ritardo);
    });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('un rinnovo che arriva dopo 3,5 secondi raggiunge il browser', () => {
  it('tessera in tasca che il portiere crede buona: il gettone nuovo arriva sulla risposta', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const raccoglitore = creaRaccoglitoreCookie();
    const richiesta = [{ name: NOME, value: cookieSessione(3600) }];

    const inCorso = chiediConTettoSuScritturaDiSessione(
      getUserCheRinnovaDopo(3500, raccoglitore),
      raccoglitore,
      tettoPerChiedereChiSei(richiesta),
    );
    await vi.advanceTimersByTimeAsync(3600);
    const esito = await inCorso;

    expect(esito.risposta.stato, 'il portiere ha smesso di aspettare un rinnovo in volo').toBe('ok');
    expect(esito.consegna.stato).toBe('consegnata');
    expect(raccoglitore.perse(), 'il gettone nuovo e arrivato a risposta gia partita').toHaveLength(0);

    const risposta = NextResponse.next();
    travasaCookie(esito.daConsegnare, risposta);
    expect(risposta.cookies.get(NOME)?.value, 'la tessera nuova non e arrivata al browser').toBe('gettone-nuovo');
  });

  it('tessera che il portiere non sa leggere: vale lo stesso il tetto lungo', () => {
    expect(tettoPerChiedereChiSei([{ name: `${NOME}.0`, value: 'pezzo-illeggibile' }])).toBe(TETTO_RINNOVO_MS);
  });

  it('nessuna tessera in tasca: niente da rinnovare, resta il tetto corto', () => {
    expect(tettoPerChiedereChiSei([])).toBe(TETTO_PORTIERE_MS);
    expect(tettoPerChiedereChiSei([{ name: 'sb-progetto-auth-token-code-verifier', value: 'x' }])).toBe(
      TETTO_PORTIERE_MS,
    );
    expect(tettoPerChiedereChiSei([{ name: 'mc_role', value: 'buyer' }])).toBe(TETTO_PORTIERE_MS);
  });

  it('il tetto lungo resta un tetto: un fornitore appeso non tiene appesa la pagina per sempre', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const raccoglitore = creaRaccoglitoreCookie();
    const inCorso = chiediConTettoSuScritturaDiSessione(
      () => new Promise<never>(() => {}),
      raccoglitore,
      tettoPerChiedereChiSei([{ name: NOME, value: cookieSessione(3600) }]),
    );
    await vi.advanceTimersByTimeAsync(TETTO_RINNOVO_MS + 50);
    const esito = await inCorso;
    expect(esito.risposta.stato).toBe('scaduto');
    expect(esito.consegna.stato).toBe('forse-persa');
  });
});
