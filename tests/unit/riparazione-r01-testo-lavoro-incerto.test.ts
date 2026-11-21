import { describe, it, expect } from 'vitest';
import { testoStatoLavoro } from '@/lib/ai/statoLavoroCatalogo';

const INCERTO = 'invio senza risposta: il lotto potrebbe essere partito, da verificare';
const CHIUSO_INCERTO =
  "invio senza risposta da 24 ore: il lotto potrebbe essere partito ed essere stato pagato; chiedi all'assistenza prima di avviarne un altro";

describe('R01-011 il testo del lavoro sul catalogo non si contraddice', () => {
  it('un invio incerto non promette «tra poco lo vedi partire»', () => {
    const t = testoStatoLavoro({ status: 'submitting', total: 12, error: INCERTO })!;
    expect(t).not.toContain('tra poco lo vedi partire');
    expect(t).toMatch(/potrebbe essere già partito/);
    expect(t).toMatch(/assistenza/);
  });
  it('un invio normale dice ancora che sta per partire', () => {
    expect(testoStatoLavoro({ status: 'submitting', total: 12, error: null })).toContain('tra poco lo vedi partire');
  });
  it('a riga chiusa col motivo dell assistenza, non dice «puoi avviarne un altro»', () => {
    const t = testoStatoLavoro({ status: 'failed', total: 12, error: CHIUSO_INCERTO })!;
    expect(t).toContain(CHIUSO_INCERTO);
    expect(t).not.toMatch(/puoi avviarne un altro/i);
  });
  it('un fallimento qualunque dice ancora «puoi avviarne un altro»', () => {
    expect(testoStatoLavoro({ status: 'error', total: 3, error: 'fornitore non raggiungibile' })).toMatch(/Puoi avviarne un altro/);
    expect(testoStatoLavoro({ status: 'canceled', total: 3 })).toMatch(/Puoi avviarne un altro/);
  });
});
