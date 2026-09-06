import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser,
  getServerSupabase: vi.fn(async () => ({ from: vi.fn() })),
  getAdminSupabase: vi.fn(() => ({
    from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(async () => ({ data: null })) })) })) })),
  })),
}));

import { withAdminAuth, chiaveDelFreno } from '@/lib/api/middleware';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

/**
 * 6/9/2026 — IL FRENO SI AZZERAVA CAMBIANDO L'ULTIMA PAROLA DELL'INDIRIZZO.
 *
 * Davanti a tutte le rotte con sessione c'e' un freno per indirizzo di rete: 300
 * tentativi al minuto, e il nome del contatore e' il percorso della richiesta. Perche'
 * quel nome sia la ROTTA e non la singola risorsa, i pezzi che sembrano identificativi
 * — numeri, UUID, stringhe esadecimali lunghe — venivano sostituiti con `:id`.
 *
 * Ma le pagine modificabili stanno su `/api/admin/cms/<parola>`, e una parola non
 * assomiglia a nessuno dei tre schemi. Risultato: `…/aaa`, `…/aab`, `…/aac` erano tre
 * contatori diversi, ognuno col budget pieno da 300. Chi voleva bussare tanto cambiava
 * la parola in fondo e il freno non scattava mai — e ogni tentativo con un gettone
 * finto ci costa comunque una chiamata al servizio di accesso, cioe' esattamente la
 * spesa che il freno era stato messo li' per evitare.
 *
 * La cura non indovina piu' la forma dei pezzi: chiede a Next quali erano variabili.
 *
 * Queste prove bussano davvero, trecento volte, cambiando la parola in fondo a ogni
 * colpo — e pretendono che il freno scatti lo stesso.
 */

const TETTO_PER_RETE = 300;

function richiesta(ip: string, percorso: string): NextRequest {
  return {
    headers: new Headers({ 'x-forwarded-for': ip }),
    nextUrl: { pathname: percorso },
    url: `http://localhost${percorso}`,
  } as unknown as NextRequest;
}

/** Il secondo argomento che Next passa a `/api/admin/cms/[slug]`. */
const contesto = (slug: string) => ({ params: Promise.resolve({ slug }) });

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitBuckets();
  delete process.env.UPSTASH_REDIS_REST_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  // Nessuna sessione: e' il caso di chi bussa a vuoto, quello che va frenato.
  getCurrentUser.mockResolvedValue(null);
});

describe('il freno non si azzera cambiando la parola in fondo all indirizzo', () => {
  it('IL CASO CHE ROMPEVA — una parola diversa a ogni colpo finisce lo stesso a 429', async () => {
    const rotta = withAdminAuth(async () => ({ status: 200 }) as never);
    const ip = '203.0.113.5';

    let ultima = 0;
    for (let i = 0; i <= TETTO_PER_RETE + 5; i++) {
      const parola = `pagina-${i}`;
      ultima = (await rotta(richiesta(ip, `/api/admin/cms/${parola}`), contesto(parola))).status;
    }

    expect(
      ultima,
      `dopo ${TETTO_PER_RETE + 5} tentativi con una parola diversa a ogni colpo la risposta e ancora ${ultima}: il freno non scatta mai`,
    ).toBe(429);
  });

  it('oltre il tetto smette proprio di chiedere a Supabase, anche cambiando parola', async () => {
    const rotta = withAdminAuth(async () => ({ status: 200 }) as never);
    const ip = '198.51.100.5';

    for (let i = 0; i < TETTO_PER_RETE; i++) {
      const parola = `riempi-${i}`;
      await rotta(richiesta(ip, `/api/admin/cms/${parola}`), contesto(parola));
    }
    const chiamatePrima = getCurrentUser.mock.calls.length;

    for (let i = 0; i < 20; i++) {
      const parola = `oltre-${i}`;
      await rotta(richiesta(ip, `/api/admin/cms/${parola}`), contesto(parola));
    }

    expect(
      getCurrentUser.mock.calls.length,
      'oltre il tetto si continua a pagare la chiamata al servizio di accesso',
    ).toBe(chiamatePrima);
  });

  it('due pagine diverse hanno lo stesso nome di contatore', () => {
    const a = chiaveDelFreno('/api/admin/cms/home', { slug: 'home' });
    const b = chiaveDelFreno('/api/admin/cms/chi-siamo', { slug: 'chi-siamo' });
    expect(a, 'la parola in fondo e ancora dentro il nome del contatore').toBe(b);
    expect(a).toBe('/api/admin/cms/:id');
  });

  it('un pezzo scritto con gli accenti vale quanto il suo parametro', () => {
    // Nel percorso arriva codificato, nei parametri di Next arriva decodificato.
    expect(chiaveDelFreno('/api/admin/cms/citt%C3%A0', { slug: 'città' })).toBe('/api/admin/cms/:id');
  });

  it('senza parametri si comporta come prima: i pezzi fissi restano al loro posto', () => {
    expect(chiaveDelFreno('/api/admin/cms/home')).toBe('/api/admin/cms/home');
    expect(chiaveDelFreno('/api/orders/1')).toBe('/api/orders/:id');
    expect(chiaveDelFreno('/api/stripe/checkout')).toBe('/api/stripe/checkout');
  });

  it('due rotte dinamiche diverse restano due contatori diversi', () => {
    const cms = chiaveDelFreno('/api/admin/cms/home', { slug: 'home' });
    const ordine = chiaveDelFreno('/api/orders/home/cancel', { id: 'home' });
    expect(cms, 'una raffica sulle pagine spegnerebbe anche gli ordini').not.toBe(ordine);
  });
});
