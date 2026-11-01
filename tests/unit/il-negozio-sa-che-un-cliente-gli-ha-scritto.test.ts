import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 1/11/2026 — Il cliente scriveva al negozio e il negozio non veniva mai avvisato.
 * `avvisaNegozioMessaggioNuovo` manda UNA email per conversazione finché il negozio non legge,
 * senza il testo del messaggio. Nessuna email vera: `sendEmail` è finto.
 */

const spedite: Array<{ to: string; subject: string; html: string; text?: string; tipo?: string }> = [];
vi.mock('@/lib/email/client', () => ({
  sendEmail: async (m: { to: string; subject: string; html: string; text?: string; tipo?: string }) => {
    spedite.push(m);
    return { ok: true, id: 'msg-1' };
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }));

const CONV = '11111111-1111-1111-1111-111111111111';
const CLIENTE = 'cliente-1';
const NEGOZIO = 'negozio-1';
const TESTO = 'Avete ancora il pane di segale? Il mio numero è 333 1234567';
const ADESSO = new Date('2026-11-01T10:00:00Z');

type Msg = { conversation_id: string; sender_id: string; body: string; read_at: string | null; created_at: string };
let messaggi: Msg[] = [];

function finto() {
  return {
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'forno@example.it' } }, error: null }) } },
    from: (tabella: string) => {
      const filtri: Array<(m: Msg) => boolean> = [];
      const q = {
        select: () => q,
        eq: (col: string, v: unknown) => { filtri.push((m) => (m as Record<string, unknown>)[col] === v); return q; },
        is: (col: string, v: unknown) => { filtri.push((m) => (m as Record<string, unknown>)[col] === v); return q; },
        gte: (col: string, v: string) => { filtri.push((m) => String((m as Record<string, unknown>)[col]) >= v); return q; },
        maybeSingle: async () =>
          tabella === 'conversations' ? { data: { buyer_id: CLIENTE, seller_id: NEGOZIO }, error: null } : { data: null, error: null },
        then: (ok: (r: unknown) => unknown) =>
          ok({ count: messaggi.filter((m) => filtri.every((f) => f(m))).length, error: null }),
      };
      return q;
    },
  };
}

function scrive(sender: string, minutiFa: number, letto = false) {
  messaggi.push({
    conversation_id: CONV, sender_id: sender, body: TESTO,
    read_at: letto ? ADESSO.toISOString() : null,
    created_at: new Date(ADESSO.getTime() - minutiFa * 60_000).toISOString(),
  });
}

async function avvisa(sender: string) {
  const { avvisaNegozioMessaggioNuovo } = await import('@/lib/email/avviso-messaggio-negozio');
  return avvisaNegozioMessaggioNuovo(finto(), { conversationId: CONV, senderId: sender }, ADESSO);
}

beforeEach(() => { spedite.length = 0; messaggi = []; });

describe('il negozio viene avvisato di un messaggio nuovo', () => {
  it('primo messaggio del cliente: parte una email al negozio, di servizio, col link alla chat e senza il testo', async () => {
    scrive(CLIENTE, 0);
    expect(await avvisa(CLIENTE)).toEqual({ inviato: true });
    expect(spedite).toHaveLength(1);
    const e = spedite[0];
    expect(e.to).toBe('forno@example.it');
    expect(e.tipo).toBe('transazionale');
    expect(e.html).toContain(`/messages/${CONV}`);
    for (const pezzo of [e.subject, e.html, e.text ?? '']) {
      expect(pezzo).not.toContain('segale');
      expect(pezzo).not.toContain('333 1234567');
    }
  });

  it('cinque messaggi di fila senza che il negozio legga: una email sola', async () => {
    for (let i = 0; i < 5; i++) {
      scrive(CLIENTE, 0);
      await avvisa(CLIENTE);
    }
    expect(spedite).toHaveLength(1);
  });

  it('dopo che il negozio ha letto, il messaggio nuovo riavvisa', async () => {
    scrive(CLIENTE, 60, true);
    scrive(CLIENTE, 0);
    expect(await avvisa(CLIENTE)).toEqual({ inviato: true });
  });

  it('se il negozio ha appena risposto (è in chat), niente email', async () => {
    scrive(NEGOZIO, 3);
    scrive(CLIENTE, 0);
    expect(await avvisa(CLIENTE)).toEqual({ inviato: false, motivo: 'negozio-in-chat' });
    expect(spedite).toHaveLength(0);
  });

  it('quando scrive il negozio non parte niente', async () => {
    scrive(NEGOZIO, 0);
    expect(await avvisa(NEGOZIO)).toEqual({ inviato: false, motivo: 'scrive-il-negozio' });
    expect(spedite).toHaveLength(0);
  });
});
