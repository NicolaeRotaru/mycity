/**
 * R18-012 — Il testo di un lavoro sul catalogo «in invio» non si contraddice. La riga nasce già col
 * motivo «invio senza risposta»: un invio appena partito non dice «non ha avuto risposta», uno rimasto
 * senza risposta non promette «tra poco lo vedi partire» per 24 ore, senza l'ora di nascita si dice una
 * frase vera nei due casi. A riga chiusa col motivo «chiedi all'assistenza» non si dice «puoi avviarne un altro».
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { testoStatoLavoro } from '@/lib/ai/statoLavoroCatalogo';

const INCERTO = 'invio senza risposta: il lotto potrebbe essere partito, da verificare';
const CHIUSO_INCERTO =
  "invio senza risposta da 24 ore: il lotto potrebbe essere partito ed essere stato pagato; chiedi all'assistenza prima di avviarne un altro";
const ADESSO = '2026-11-20T12:00:00.000Z';
const fa = (ms: number) => new Date(Date.parse(ADESSO) - ms).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(ADESSO));
});
afterEach(() => vi.useRealTimers());

describe('R18-012 il testo del lavoro sul catalogo non si contraddice', () => {
  it('un invio appena partito (5 secondi) non dice che è rimasto senza risposta', () => {
    const t = testoStatoLavoro({ status: 'submitting', total: 12, error: INCERTO, createdAt: fa(5_000) })!;
    expect(t).not.toMatch(/non ha avuto risposta/);
    expect(t).toMatch(/non riavviarlo/);
  });
  it('un invio senza risposta da 10 minuti non promette «tra poco lo vedi partire»', () => {
    const t = testoStatoLavoro({ status: 'submitting', total: 12, error: INCERTO, createdAt: fa(10 * 60_000) })!;
    expect(t).not.toContain('tra poco lo vedi partire');
    expect(t).toMatch(/potrebbe essere già partito/);
    expect(t).toMatch(/assistenza/);
  });
  it('senza l’ora di nascita non promette la partenza e non dà per fatto che non ha risposto', () => {
    const t = testoStatoLavoro({ status: 'submitting', total: 12, error: INCERTO })!;
    expect(t).not.toContain('tra poco lo vedi partire');
    expect(t).not.toMatch(/non ha avuto risposta/);
    expect(t).toMatch(/non riavviarlo/);
    expect(t).toMatch(/assistenza/);
  });
  it('un invio normale, senza motivo, dice ancora che sta per partire', () => {
    expect(testoStatoLavoro({ status: 'submitting', total: 12, error: null })).toContain('tra poco lo vedi partire');
  });
  it('a riga chiusa col motivo «chiedi all’assistenza» non dice «puoi avviarne un altro»', () => {
    const t = testoStatoLavoro({ status: 'failed', total: 12, error: CHIUSO_INCERTO })!;
    expect(t).toMatch(/chiedi all'assistenza/);
    expect(t).not.toMatch(/Puoi avviarne un altro/);
  });
  it('un errore qualunque dice ancora «puoi avviarne un altro»', () => {
    expect(testoStatoLavoro({ status: 'error', total: 3, error: 'x' })).toMatch(/Puoi avviarne un altro/);
  });
});
