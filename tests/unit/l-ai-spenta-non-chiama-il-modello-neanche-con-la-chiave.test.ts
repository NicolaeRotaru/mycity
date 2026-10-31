import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

type Finto = Mock<(...a: unknown[]) => Promise<unknown>>;

/**
 * 31/10/2026 — «AI PER I NEGOZI» SPENTA: NESSUNA CHIAMATA AL MODELLO, ANCHE SE
 * LA CHIAVE C'È.
 *
 * Prima l'interruttore AI_NEGOZI_ACCESA lo leggevano solo le pagine. Il freno
 * vero era la chiave ANTHROPIC_API_KEY che in produzione manca: chi l'avesse
 * messa su Vercel per un altro motivo riaccendeva le diciotto rotte /api/ai,
 * mentre la pagina continuava a dire «spento». Qui la chiave c'è, l'interruttore
 * è spento, e si guarda se al modello parte qualcosa.
 *
 * L'interruttore si finge con un getter, così si prova anche il verso «acceso».
 */

const stato = vi.hoisted(() => ({
  aiAccesa: false,
  create: undefined as unknown as Finto,
}));

vi.mock('@/lib/funzioni-al-lancio', async (originale) => {
  const vero = (await originale()) as Record<string, unknown>;
  return { ...vero, get AI_NEGOZI_ACCESA() { return stato.aiAccesa; } };
});

vi.mock('@anthropic-ai/sdk', () => {
  stato.create = vi.fn(async () => ({
    content: [{ type: 'text', text: 'Pane di grano duro, cotto a legna.' }],
    usage: { input_tokens: 10, output_tokens: 10 },
    stop_reason: 'end_turn',
  }));
  class AnthropicFinto {
    messages = { create: (...a: unknown[]) => stato.create(...a) };
  }
  return { default: AnthropicFinto };
});

vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (gestore: (c: { user: { id: string }; req: Request }) => unknown) => (req: Request) =>
    gestore({ user: { id: 'seller-1' }, req }),
}));

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { store_name: 'Bottega' }, error: null }) }) }) }),
  }),
}));

import { getAnthropic, AiConfigError, __resetAnthropicClient } from '@/lib/ai/client';
import { POST as scriviDescrizione } from '@/app/api/ai/description/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

function richiesta(corpo: unknown): never {
  return new Request('http://localhost/api/ai/description', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  }) as never;
}

beforeEach(() => {
  __resetAnthropicClient();
  __resetRateLimitBuckets();
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-chiave-messa-per-altro');
  stato.aiAccesa = false;
  stato.create.mockClear();
});

describe('il client del modello legge l interruttore', () => {
  it('spenta, con la chiave presente: getAnthropic rifiuta come senza chiave', () => {
    expect(() => getAnthropic()).toThrow(AiConfigError);
  });

  it('un client già costruito ad AI accesa non scavalca lo spegnimento', () => {
    stato.aiAccesa = true;
    expect(getAnthropic()).toBeTruthy();
    stato.aiAccesa = false;
    expect(() => getAnthropic()).toThrow(AiConfigError);
  });
});

describe('una rotta /api/ai chiamata a mano ad AI spenta', () => {
  it('risponde «non disponibile» e al modello non parte nessuna richiesta', async () => {
    const res = await scriviDescrizione(richiesta({ name: 'Pane di Altamura', category: 'Panetteria' }));
    expect(res.status).toBe(503);
    expect(stato.create).not.toHaveBeenCalled();
  });

  it('controprova: accesa, la stessa richiesta arriva al modello', async () => {
    stato.aiAccesa = true;
    await scriviDescrizione(richiesta({ name: 'Pane di Altamura', category: 'Panetteria' }));
    expect(stato.create).toHaveBeenCalled();
  });
});
