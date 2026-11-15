/**
 * R21-018 — Dopo troppi tentativi di accesso la pagina diceva «qualche minuto»
 * invece di dire quanto aspettare.
 *
 * La palestra del 7/11: dodici password sbagliate sullo stesso account. Dal
 * primo al decimo tentativo 401; all'undicesimo il freno (10 ogni 5 minuti per
 * email) risponde 429 con Retry-After di 261 secondi. A schermo restava
 * «Troppi tentativi su questo account. Riprova tra qualche minuto.»: nessun
 * numero. Il server l'attesa la sa al secondo.
 *
 * Qui: la rotta vera, col freno vero in memoria e l'orologio finto. La frase
 * dice i minuti arrotondati per eccesso su tutti e tre i rami, e la pagina
 * ricava l'attesa dall'intestazione Retry-After.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const signInMock = vi.fn();
vi.mock('@/lib/supabase/auth-server', () => ({
  authServer: {
    signIn: async (...args: unknown[]) => {
      const res = await signInMock(...args);
      return { ...(res as object), client: { auth: { signOut: async () => {} } } };
    },
  },
}));
vi.mock('@/lib/captcha', () => ({ verifyTurnstileToken: vi.fn(async () => ({ ok: true })) }));

import { POST } from '@/app/api/auth/signin/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { esitoDellaRispostaDiAccesso, messaggioDellaRottaDiAccesso } from '@/lib/auth/conferma-email';

function richiesta(email: string, ip: string): Request {
  return new Request('http://localhost/api/auth/signin', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ email, password: 'sbagliata1', captchaToken: 't' }),
  });
}

const INIZIO = new Date('2026-11-07T10:00:00.000Z').getTime();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(INIZIO);
  __resetRateLimitBuckets();
  signInMock.mockReset();
  signInMock.mockResolvedValue({ data: null, error: { message: 'Invalid login credentials', status: 400 } });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R21-018 la rotta di accesso dice quanti minuti aspettare', () => {
  it('IL CASO DELLA PALESTRA — undicesimo tentativo sullo stesso account dopo 39 secondi: «Riprova fra 5 minuti.»', async () => {
    // Dieci tentativi sullo stesso account, ognuno da una rete diversa (il freno per rete non scatta).
    for (let i = 0; i < 10; i++) {
      const r = await POST(richiesta('maria@esempio.it', `10.0.0.${i + 1}`));
      expect(r.status).toBe(401);
    }
    vi.setSystemTime(INIZIO + 39_000);
    const bloccata = await POST(richiesta('maria@esempio.it', '10.0.1.1'));
    expect(bloccata.status).toBe(429);
    expect(bloccata.headers.get('Retry-After')).toBe('261');
    const corpo = await bloccata.json();
    expect(corpo.error.message).toBe('Troppi tentativi su questo account. Riprova fra 5 minuti.');
    expect(corpo.error.message).not.toMatch(/qualche minuto/);

    // La pagina, con quello che le arriva, sa quanto spegnere «Accedi» e cosa scrivere.
    const esito = esitoDellaRispostaDiAccesso(false, corpo, bloccata.headers.get('Retry-After'));
    expect(esito).toMatchObject({ tipo: 'errore', codice: 'RATE_LIMITED', attesaSecondi: 261 });
    expect(messaggioDellaRottaDiAccesso(esito)).toBe('Troppi tentativi su questo account. Riprova fra 5 minuti.');
  });

  it('il freno per rete dice anche lui i minuti, e un minuto si scrive al singolare', async () => {
    for (let i = 0; i < 10; i++) {
      const r = await POST(richiesta(`cliente${i}@esempio.it`, '10.9.9.9'));
      expect(r.status).toBe(401);
    }
    // 4 minuti e 10 secondi dopo: mancano 50 secondi, cioè «1 minuto».
    vi.setSystemTime(INIZIO + 250_000);
    const bloccata = await POST(richiesta('altro@esempio.it', '10.9.9.9'));
    expect(bloccata.status).toBe(429);
    expect(bloccata.headers.get('Retry-After')).toBe('50');
    expect((await bloccata.json()).error.message).toBe('Troppi tentativi di accesso. Riprova fra 1 minuto.');
  });

  it('quando a frenare è Supabase, la frase dice il minuto che la rotta manda nell’intestazione', async () => {
    signInMock.mockResolvedValue({ data: null, error: { code: 'over_request_rate_limit', status: 429, message: 'rate limit' } });
    const r = await POST(richiesta('pino@esempio.it', '10.5.5.5'));
    expect(r.status).toBe(429);
    expect(r.headers.get('Retry-After')).toBe('60');
    expect((await r.json()).error.message).toBe('Troppi tentativi di accesso. Riprova fra 1 minuto.');
  });
});

describe('R21-018 la pagina ricava l’attesa dalla risposta', () => {
  const corpo429 = { ok: false, error: { code: 'RATE_LIMITED', message: 'Troppi tentativi di accesso. Riprova fra 5 minuti.' } };

  it('un 429 con Retry-After porta i secondi da aspettare', () => {
    expect(esitoDellaRispostaDiAccesso(false, corpo429, '256')).toMatchObject({ attesaSecondi: 256 });
  });

  it('senza intestazione, o con un numero assurdo, nessuna attesa inventata', () => {
    expect(esitoDellaRispostaDiAccesso(false, corpo429)).not.toHaveProperty('attesaSecondi');
    expect(esitoDellaRispostaDiAccesso(false, corpo429, 'domani')).not.toHaveProperty('attesaSecondi');
    expect(esitoDellaRispostaDiAccesso(false, corpo429, '-5')).not.toHaveProperty('attesaSecondi');
  });

  it('una password sbagliata non spegne niente, anche se l’intestazione ci fosse', () => {
    expect(
      esitoDellaRispostaDiAccesso(false, { error: { code: 'UNAUTHORIZED', message: 'Email o password non corretti' } }, '30'),
    ).toEqual({ tipo: 'errore', messaggio: 'Email o password non corretti', codice: 'UNAUTHORIZED' });
  });
});
