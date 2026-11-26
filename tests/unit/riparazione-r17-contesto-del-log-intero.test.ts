import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R17-011 — Un BigInt nel contesto (JSON.stringify lancia) o un `toJSON` che lancia facevano cadere la
 * scrittura della riga intera: usciva solo «contesto: [non scrivibile]», e con lui spariva tutto il
 * resto (l'ordine, il motivo). Date, Map e Set uscivano come `{}`. Qui si legge la riga vera che
 * esce sulla console.
 */

vi.mock('@/lib/analytics/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

let righe: string[] = [];
beforeEach(() => {
  righe = [];
  vi.resetModules();
  for (const livello of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, livello).mockImplementation((...a: unknown[]) => {
      righe.push(a.map(String).join(' '));
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function rigaDi(ctx: unknown): Promise<Record<string, unknown>> {
  const { logger } = await import('@/lib/logger');
  logger.warn('rimborso fallito', ctx);
  expect(righe).toHaveLength(1);
  return JSON.parse(righe[0]) as Record<string, unknown>;
}

describe('R17-011 · un valore che non si scrive non si porta via il contesto', () => {
  it('IL CASO: un BigInt nel contesto → il BigInt esce come testo e l ordine resta', async () => {
    const riga = await rigaDi({ orderId: 'ord_1', motivo: 'carta rifiutata', importoCentesimi: BigInt('9007199254740993') });
    expect(riga.contesto).toBeUndefined();
    expect(riga.orderId).toBe('ord_1');
    expect(riga.motivo).toBe('carta rifiutata');
    expect(riga.importoCentesimi).toBe('9007199254740993');
    expect(riga.msg).toBe('rimborso fallito');
  });

  it('un BigInt annidato, in un elenco', async () => {
    const riga = await rigaDi({ orderId: 'ord_2', righe: [{ id: BigInt(1) }, { id: BigInt(2) }] });
    expect(riga.orderId).toBe('ord_2');
    expect(riga.righe).toEqual([{ id: '1' }, { id: '2' }]);
  });

  it('un toJSON che lancia (proprio dell oggetto, anche annidato) non fa cadere la riga', async () => {
    const rotto = { toJSON: () => { throw new Error('non mi scrivo'); }, stato: 'pending' };
    const riga = await rigaDi({ orderId: 'ord_3', pagamento: rotto, toJSON: () => { throw new Error('nemmeno io'); } });
    expect(riga.contesto).toBeUndefined();
    expect(riga.orderId).toBe('ord_3');
    expect(riga.pagamento).toEqual({ stato: 'pending' });
  });

  it('un toJSON che lancia sul prototipo di una classe non conta: si scrivono i campi', async () => {
    class Importo {
      constructor(public euro: number) {}
      toJSON(): never { throw new Error('rotto'); }
    }
    const riga = await rigaDi({ orderId: 'ord_4', totale: new Importo(12) });
    expect(riga.orderId).toBe('ord_4');
    expect(riga.totale).toEqual({ euro: 12 });
  });

  it('Date, Map e Set escono leggibili, non come {}', async () => {
    const riga = await rigaDi({
      quando: new Date('2026-11-26T09:30:00.000Z'),
      mai: new Date('non è una data'),
      perNegozio: new Map<string, unknown>([['n-pane', 2], ['email', 'anna@example.it']]),
      etichette: new Set(['fresco', 'bio']),
    });
    expect(riga.quando).toBe('2026-11-26T09:30:00.000Z');
    expect(riga.mai).toBe('Invalid Date');
    expect(riga.perNegozio).toEqual({ 'n-pane': 2, email: '[redacted]' });
    expect(riga.etichette).toEqual(['fresco', 'bio']);
    expect(righe[0]).not.toContain('anna@example.it');
  });

  it('una Map che contiene se stessa si ferma al limite, senza lanciare', async () => {
    const m = new Map<string, unknown>([['ordine', 'ord_5']]);
    m.set('io', m);
    const riga = await rigaDi({ m });
    expect((riga.m as Record<string, unknown>).ordine).toBe('ord_5');
    expect(righe[0]).toContain('[troppo profondo]');
  });

  it('un valore annidato con chiavi che lanciano diventa solo lui [non leggibile]', async () => {
    const rotto = new Proxy({}, { ownKeys() { throw new Error('x'); } });
    const riga = await rigaDi({ orderId: 'ord_9', motivo: 'carta rifiutata', rotto });
    expect(riga.contesto).toBeUndefined();
    expect(riga.orderId).toBe('ord_9');
    expect(riga.motivo).toBe('carta rifiutata');
    expect(riga.rotto).toBe('[non leggibile]');
  });

  it('una chiave __proto__ resta una chiave e non cambia il prototipo', async () => {
    const riga = await rigaDi(JSON.parse('{"orderId":"ord_8","__proto__":{"admin":true}}'));
    expect(riga.orderId).toBe('ord_8');
    expect(Object.keys(riga)).toContain('__proto__');
    expect((riga as { admin?: unknown }).admin).toBeUndefined();
  });
});
