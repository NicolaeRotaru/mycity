import { describe, it, expect, vi } from 'vitest';
import * as client from '@/lib/ai/client';

/** 1/11/2026 — Dal 30/11/2026 un modello ritirato ancora in uso finisce nei log d'errore. */
describe('il modello ritirato si segnala', () => {
  it('dal 30/11/2026 un modello ritirato in uso si segnala come errore', () => {
    const errore = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(client.segnalaModelloRitirato('claude-sonnet-4-5', new Date('2026-11-29T12:00:00Z'))).toBe(false);
    expect(client.segnalaModelloRitirato('claude-sonnet-4-5', new Date('2026-11-30T08:00:00Z'))).toBe(true);
    expect(client.segnalaModelloRitirato('claude-sonnet-4-6', new Date('2026-12-15T08:00:00Z'))).toBe(false);
    expect(errore).toHaveBeenCalledTimes(1);
    errore.mockRestore();
  });
});
