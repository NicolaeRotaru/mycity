/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

/**
 * 20/11/2026 (R04-015) — IL MODULO DELL'ASSISTENZA NON MANDAVA UNA CHIAVE CHE LA ROTTA LEGGESSE.
 *
 * Il 19/11 il modulo aveva preso una chiave per invio, ma solo nell'intestazione: la rotta non la
 * guardava, e il collaudo l'ha bocciata. La rotta adesso legge `idempotency_key` dal corpo (R04-012):
 * il modulo la mette lì. Una chiave nuova per ogni invio della persona, la stessa nei ritentativi
 * dello stesso invio e nel doppio clic, una nuova dopo un invio riuscito.
 * Si monta il modulo vero, con fetch finto che annota il corpo di ogni richiesta.
 */

const globali = globalThis as Record<string, unknown>;

afterEach(() => {
  document.body.innerHTML = '';
  for (const k of ['__NAVIGAZIONI__', '__UTENTE__', '__GETTONE__']) globali[k] = undefined;
  vi.unstubAllGlobals();
});

type Invio = { chiaveNelCorpo: unknown; intestazione: string | null; testo: unknown };

async function prepara(risposte: Array<'rete' | 'ok'>) {
  globali.__NAVIGAZIONI__ = [];
  globali.__UTENTE__ = { id: 'cliente-1', email: 'c@test.it' };
  globali.__GETTONE__ = 'gettone';
  const invii: Invio[] = [];
  let n = 0;
  vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init: { headers: Record<string, string>; body: string }) => {
    const h = Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v]));
    const corpo = JSON.parse(init.body) as Record<string, unknown>;
    invii.push({ chiaveNelCorpo: corpo.idempotency_key, intestazione: h['idempotency-key'] ?? null, testo: corpo.firstMessage });
    if (risposte[n++] === 'rete') throw new TypeError('rete caduta');
    return new Response(JSON.stringify({ conversationId: 'c1', supportId: 's1' }), { status: 200 });
  }));
  const Modale = (await monta('components/SupportChatModal.tsx')).default as ComponentType<Record<string, unknown>>;
  // onClose non chiude: il modulo resta montato e si può inviare ancora.
  const s = accendi(Modale, { open: true, onClose: () => {}, role: 'buyer' });
  await attendi();
  const bottone = (testo: string) => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent?.includes(testo));
    expect(b, `controprova: «${testo}» si deve vedere`).toBeTruthy();
    return b!;
  };
  const assesta = async () => {
    for (let i = 0; i < 20; i++) await attendi();
  };
  const premi = async (testo: string) => {
    s.agisci(() => clicca(bottone(testo)));
    await assesta();
  };
  const doppioClic = async (testo: string) => {
    const b = bottone(testo);
    s.agisci(() => {
      clicca(b);
      clicca(b);
    });
    await assesta();
  };
  return { invii, premi, doppioClic, s };
}

describe('R04-015 — il modulo dell’assistenza manda la chiave dell’invio nel corpo', () => {
  it('ogni invio porta la chiave nel corpo, nel campo che la rotta legge (idempotency_key)', async () => {
    const { invii, premi, s } = await prepara(['ok']);
    await premi('Dov');
    expect(invii).toHaveLength(1);
    expect(invii[0].chiaveNelCorpo, 'senza la chiave nel corpo la rotta non riconosce il doppione').toMatch(/^[0-9a-f-]{36}$/);
    expect(invii[0].chiaveNelCorpo, 'corpo e intestazione devono dire la stessa chiave').toBe(invii[0].intestazione);
    s.smonta();
  }, 60000);

  it('il doppio clic sullo stesso testo porta la stessa chiave', async () => {
    const { invii, doppioClic, s } = await prepara(['ok', 'ok']);
    await doppioClic('Dov');
    expect(invii.length, 'il doppio clic non ha mandato niente').toBeGreaterThan(0);
    const chiavi = new Set(invii.map((i) => i.chiaveNelCorpo));
    expect(chiavi.size, `due clic sullo stesso testo, chiavi diverse: ${JSON.stringify([...chiavi])}`).toBe(1);
    expect([...chiavi][0]).toBeTruthy();
    s.smonta();
  }, 60000);

  it('il ritentativo dopo la rete caduta riusa la chiave; dopo un invio riuscito la chiave è nuova', async () => {
    const { invii, premi, s } = await prepara(['rete', 'ok', 'ok']);
    await premi('Dov');
    await premi('Dov');
    expect(invii).toHaveLength(2);
    expect(invii[0].chiaveNelCorpo).toBeTruthy();
    expect(invii[1].chiaveNelCorpo, 'lo stesso invio ritentato ha cambiato chiave').toBe(invii[0].chiaveNelCorpo);
    await premi('Dov');
    expect(invii).toHaveLength(3);
    expect(invii[2].chiaveNelCorpo, 'dopo un invio riuscito lo stesso testo è un messaggio nuovo').toBeTruthy();
    expect(invii[2].chiaveNelCorpo).not.toBe(invii[1].chiaveNelCorpo);
    s.smonta();
  }, 60000);
});
