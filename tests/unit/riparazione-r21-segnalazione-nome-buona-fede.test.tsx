// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, createElement, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * R21-014 — IL MODULO DI SEGNALAZIONE NON PERMETTEVA DI DARE IL NOME DI CHI SEGNALA NÉ DI DICHIARARE
 * LA BUONA FEDE.
 *
 * Il modulo aveva solo motivo, testo ed email, e lo schema della rotta non aveva altri campi. Il
 * regolamento europeo sui servizi digitali (art. 16.2, lettere c e d) chiede che il canale consenta
 * il nome e la dichiarazione di buona fede; non chiede di rifiutare chi non li dà.
 *
 * La prova apre il modulo vero, scrive il nome e spunta la dichiarazione, e guarda che cosa parte;
 * poi esegue la rotta vera con un database finto e guarda che cosa arriva all'amministratore, che
 * legge il testo della segnalazione. Infine guarda che l'informativa nomini il dato nuovo.
 */

const stato = vi.hoisted(() => ({ inserite: [] as Array<Record<string, unknown>> }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/rate-limit', () => ({ getClientIp: () => '1.2.3.4', rateLimitAsync: async () => ({ allowed: true, retryAfterSec: 0 }) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: async () => ({ ok: true, id: 'm1' }) }));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
  getAdminSupabase: () => ({
    from: (t: string) => {
      if (t === 'products' || t === 'seller_public_profiles') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'esiste' }, error: null }) }) }) };
      }
      if (t === 'profiles') return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
      return {
        insert: (r: Record<string, unknown>) => {
          stato.inserite.push(r);
          return { select: () => ({ single: async () => ({ data: { id: 'seg-7' }, error: null }) }) };
        },
      };
    },
  }),
}));

import { POST } from '@/app/api/segnalazioni/route';

function segnala(extra: Record<string, unknown>) {
  return POST(new Request('http://x/api/segnalazioni', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tipo: 'prodotto',
      oggettoId: '11111111-1111-4111-8111-111111111111',
      motivo: 'proprieta_intellettuale',
      ...extra,
    }),
  }) as never);
}

beforeEach(() => {
  stato.inserite.length = 0;
});

describe('R21-014 · la rotta tiene nome e buona fede, e l amministratore li legge', () => {
  it('IL CASO CHE ROMPEVA — nome e dichiarazione arrivano nel testo che l amministratore esamina', async () => {
    const res = await segnala({
      dettaglio: 'La borsa usa il nostro marchio registrato senza licenza.',
      nomeSegnalante: 'Pelletteria Bianchi srl',
      buonaFede: true,
    });
    expect(res.status).toBe(201);
    expect(stato.inserite).toHaveLength(1);
    const testo = String(stato.inserite[0].dettaglio);
    expect(testo).toContain('La borsa usa il nostro marchio registrato senza licenza.');
    expect(testo, 'il nome di chi segnala si è perso per strada').toContain('Pelletteria Bianchi srl');
    expect(testo, 'la dichiarazione di buona fede si è persa per strada').toMatch(/buona fede/i);
  });

  it('anche senza testo, il nome da solo arriva', async () => {
    await segnala({ nomeSegnalante: 'Mario Rossi' });
    expect(String(stato.inserite[0]?.dettaglio)).toContain('Mario Rossi');
  });

  it('sono facoltativi: senza, la segnalazione arriva com era', async () => {
    const res = await segnala({ dettaglio: 'Prezzo ingannevole.' });
    expect(res.status).toBe(201);
    expect(stato.inserite[0].dettaglio).toBe('Prezzo ingannevole.');
  });

  it('un testo che con nome e dichiarazione supera il limite della colonna si ferma prima', async () => {
    const res = await segnala({ dettaglio: 'a'.repeat(2000), nomeSegnalante: 'Mario Rossi', buonaFede: true });
    expect(res.status).toBe(400);
    expect(stato.inserite).toHaveLength(0);
  });
});

describe('R21-014 · il modulo permette di dare il nome e di dichiarare la buona fede', () => {
  let root: Root | null = null;
  let box: HTMLDivElement;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    box = document.createElement('div');
    document.body.appendChild(box);
  });
  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    box.remove();
    vi.unstubAllGlobals();
  });

  it('IL CASO CHE ROMPEVA — il nome scritto e la casella spuntata partono con la segnalazione', async () => {
    const fetchFinto = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true, id: 'seg-7', conferma: 'nessun_recapito' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchFinto);
    const { Segnala } = await import('@/components/Segnala');
    root = createRoot(box);
    await act(async () => { root!.render(createElement(Segnala, { tipo: 'prodotto', oggettoId: '11111111-1111-4111-8111-111111111111' })); });
    const apri = [...box.querySelectorAll('button')].find((b) => b.textContent?.includes('Segnala questo contenuto'))!;
    await act(async () => { apri.click(); });

    const etichette = [...document.body.querySelectorAll('label')];
    const perNome = etichette.find((l) => /nome/i.test(l.textContent ?? ''));
    const perBuonaFede = etichette.find((l) => /buona fede/i.test(l.textContent ?? ''));
    expect(perNome, 'nel modulo non c è un campo per il nome di chi segnala').toBeTruthy();
    expect(perBuonaFede, 'nel modulo non c è la dichiarazione di buona fede').toBeTruthy();

    const campoNome = (perNome!.control ?? document.getElementById(perNome!.htmlFor)) as HTMLInputElement | null;
    const casella = (perBuonaFede!.control ?? perBuonaFede!.querySelector('input')) as HTMLInputElement | null;
    expect(campoNome?.type, 'l etichetta del nome non porta a un campo').toBe('text');
    expect(casella?.type, 'la dichiarazione non è una casella da spuntare').toBe('checkbox');
    expect(casella!.checked, 'la dichiarazione deve essere una scelta, non già spuntata').toBe(false);

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(campoNome, 'Pelletteria Bianchi srl'); campoNome!.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { casella!.click(); });

    const invia = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes('Invia segnalazione'))!;
    await act(async () => { invia.click(); });

    expect(fetchFinto).toHaveBeenCalledTimes(1);
    const corpo = JSON.parse(String(fetchFinto.mock.calls[0][1]?.body));
    expect(corpo.nomeSegnalante).toBe('Pelletteria Bianchi srl');
    expect(corpo.buonaFede).toBe(true);
  });
});

describe('R21-014 · l informativa nomina il dato nuovo', () => {
  let Pagina: ComponentType<Record<string, unknown>>;
  beforeAll(async () => {
    Pagina = (await monta('app/privacy/page.tsx')).default as ComponentType<Record<string, unknown>>;
  }, 60000);

  it('fra i dati raccolti per le segnalazioni c è il nome, se lo dai', () => {
    const s = accendi(Pagina);
    try {
      const voce = Array.from(s.radice.querySelectorAll('#dati li'))
        .map((li) => testoVisibile(li))
        .find((t) => /segnalazion/i.test(t));
      expect(voce, 'le segnalazioni non compaiono fra i dati raccolti').toBeTruthy();
      expect(voce, 'l informativa non dice che raccogliamo il nome di chi segnala').toMatch(/nome/);
    } finally {
      s.smonta();
    }
  }, 60000);
});
