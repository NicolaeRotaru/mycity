import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * La fila delle email non si appoggia piu' a un file interno di Next (`next/dist/...`): usa solo
 * API pubbliche. Le funzioni in fila partono dopo la risposta, cioe' dentro il callback di after().
 */
const registrati: Array<() => unknown> = [];
vi.mock('next/server', () => ({ after: (fn: () => unknown) => void registrati.push(fn) }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { dopoLaRisposta } from '@/lib/api/dopo-la-risposta';

describe('dopo-la-risposta', () => {
  it('nessun import interno di Next', () => {
    const src = readFileSync(join(process.cwd(), 'lib', 'api', 'dopo-la-risposta.ts'), 'utf8');
    const importi = src.split('\n').filter((r) => /^\s*import\b/.test(r));
    expect(importi.filter((r) => r.includes('next/dist'))).toEqual([]);
  });

  it('fuori da una richiesta i lavori partono solo dopo la risposta, in fila', async () => {
    const diario: string[] = [];
    dopoLaRisposta(async () => { diario.push('1'); }, 'uno');
    dopoLaRisposta(async () => { diario.push('2'); }, 'due');
    expect(diario).toEqual([]);
    await Promise.all(registrati.splice(0).map((fn) => fn()));
    expect(diario).toEqual(['1', '2']);
  });
});
