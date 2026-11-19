/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

/**
 * R04-017 — il modulo dell'assistenza manda una chiave per invio.
 * Un invio ritentato (doppio clic, rete caduta) porta la stessa chiave; un messaggio nuovo,
 * o uno dopo un invio riuscito, ne porta una nuova. Si monta il modulo vero, con fetch finto.
 */

const globali = globalThis as Record<string, unknown>;

afterEach(() => {
  document.body.innerHTML = '';
  for (const k of ['__NAVIGAZIONI__', '__UTENTE__', '__GETTONE__']) globali[k] = undefined;
  vi.unstubAllGlobals();
});

async function prepara(risposte: Array<'rete' | 'ok'>) {
  globali.__NAVIGAZIONI__ = [];
  globali.__UTENTE__ = { id: 'cliente-1', email: 'c@test.it' };
  globali.__GETTONE__ = 'gettone';
  const chiavi: Array<string | null> = [];
  let n = 0;
  vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init: { headers: Record<string, string> }) => {
    const h = Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v]));
    chiavi.push(h['idempotency-key'] ?? null);
    if (risposte[n++] === 'rete') throw new TypeError('rete caduta');
    return new Response(JSON.stringify({ conversationId: 'c1', supportId: 's1' }), { status: 200 });
  }));
  const Modale = (await monta('components/SupportChatModal.tsx')).default as ComponentType<Record<string, unknown>>;
  // onClose non chiude: il modulo resta montato e si può inviare ancora.
  const s = accendi(Modale, { open: true, onClose: () => {}, role: 'buyer' });
  await attendi();
  const premi = async (testo: string) => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent?.includes(testo));
    expect(b, `controprova: «${testo}» si deve vedere`).toBeTruthy();
    s.agisci(() => clicca(b!));
    for (let i = 0; i < 20; i++) await attendi();
  };
  return { chiavi, premi, s };
}

describe('R04-017 — la chiave per invio del modulo dell\'assistenza', () => {
  it('ogni invio porta una chiave', async () => {
    const { chiavi, premi, s } = await prepara(['ok']);
    await premi('Dov');
    expect(chiavi).toHaveLength(1);
    expect(chiavi[0], 'senza chiave la rotta non può riconoscere un doppione').toMatch(/^[0-9a-f-]{36}$/);
    s.smonta();
  }, 60000);

  it('lo stesso invio ritentato dopo un errore di rete riusa la chiave', async () => {
    const { chiavi, premi, s } = await prepara(['rete', 'ok']);
    await premi('Dov');
    await premi('Dov');
    expect(chiavi).toHaveLength(2);
    expect(chiavi[0]).toBeTruthy();
    expect(chiavi[1]).toBe(chiavi[0]);
    s.smonta();
  }, 60000);

  it('un messaggio diverso, o dopo un invio riuscito, ha una chiave nuova', async () => {
    const { chiavi, premi, s } = await prepara(['rete', 'ok', 'ok']);
    await premi('Dov');
    await premi('Come richiedo');
    expect(chiavi[1], 'testo diverso, invio diverso').not.toBe(chiavi[0]);
    await premi('Come richiedo');
    expect(chiavi[2], 'dopo un invio riuscito, lo stesso testo è un messaggio nuovo').not.toBe(chiavi[1]);
    s.smonta();
  }, 60000);

  it('senza crypto.randomUUID l\'invio parte lo stesso con una chiave non vuota', async () => {
    const { chiavi, premi, s } = await prepara(['ok']);
    vi.stubGlobal('crypto', {});
    await premi('Dov');
    expect(chiavi, 'l\'invio non è partito').toHaveLength(1);
    expect(chiavi[0]).toBeTruthy();
    s.smonta();
  }, 60000);
});
