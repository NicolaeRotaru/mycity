/**
 * 22/8/2026 — «RIPROVA FRA UN MINUTO», SEMPRE, ANCHE QUANDO NON ERA VERO.
 *
 * Quando Anthropic ci limita, la sua risposta porta un header che dice quanti
 * secondi aspettare. Noi non lo leggevamo: rispondevamo al venditore con un
 * minuto fisso, scritto nel codice. Se la finestra vera era di dieci secondi
 * aspettava per niente; se era di cinque minuti riprovava quattro volte a
 * vuoto, e ogni tentativo si prendeva un altro rifiuto.
 *
 * Queste prove diventano rosse se l'header torna a essere ignorato.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mapAiError, extractRetryAfter, AiCallError } from '@/lib/ai/run';

function attesaDichiarata(res: Response): number {
  return Number(res.headers.get('Retry-After'));
}

afterEach(() => vi.restoreAllMocks());

describe('quando Anthropic ci limita', () => {
  it('l\'attesa è quella che dichiara lui, non un minuto fisso', () => {
    // Il margine casuale è al massimo di 5 secondi: 300 dichiarati stanno
    // dentro la finestra 300-304, che un minuto fisso non tocca mai.
    const err = new AiCallError('ai-test', 429, undefined, 300);
    const attesa = attesaDichiarata(mapAiError(err, 'ai-test'));
    expect(attesa).toBeGreaterThanOrEqual(300);
    expect(attesa).toBeLessThan(305);
  });

  it('senza header dichiarato resta il minuto di ripiego', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const err = new AiCallError('ai-test', 429, undefined, undefined);
    expect(attesaDichiarata(mapAiError(err, 'ai-test'))).toBe(60);
  });

  it('due venditori fermati insieme non ripartono nello stesso istante', () => {
    const attese = new Set<number>();
    for (let i = 0; i < 200; i += 1) {
      attese.add(attesaDichiarata(mapAiError(new AiCallError('ai-test', 429, undefined, 100), 'x')));
    }
    expect(attese.size).toBeGreaterThan(1);
  });

  it('legge l\'header sia dagli Headers del fetch sia da un oggetto semplice', () => {
    expect(extractRetryAfter({ headers: new Headers({ 'retry-after': '42' }) })).toBe(42);
    expect(extractRetryAfter({ headers: { 'retry-after': '42' } })).toBe(42);
  });

  it('un header assurdo o rotto non diventa un\'attesa', () => {
    expect(extractRetryAfter({ headers: { 'retry-after': 'domani' } })).toBeUndefined();
    expect(extractRetryAfter({ headers: { 'retry-after': '-5' } })).toBeUndefined();
    expect(extractRetryAfter({ headers: { 'retry-after': '99999' } })).toBeUndefined();
    expect(extractRetryAfter({})).toBeUndefined();
  });
});
