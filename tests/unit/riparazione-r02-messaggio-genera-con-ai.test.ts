import { describe, it, expect } from 'vitest';
import { messaggioDelRisultato } from '@/components/AIDescriptionButton';

describe('il messaggio di «Genera con AI» distingue la proposta dal testo applicato', () => {
  it('sopra un campo vuoto il testo e nel campo: «modifica come preferisci»', () => {
    expect(messaggioDelRisultato('')).toBe('Descrizione generata — modifica come preferisci');
    expect(messaggioDelRisultato('   ')).toBe('Descrizione generata — modifica come preferisci');
    expect(messaggioDelRisultato(undefined)).toBe('Descrizione generata — modifica come preferisci');
  });
  it('sopra una descrizione gia scritta e solo una proposta, e il messaggio non dice «modifica»', () => {
    const m = messaggioDelRisultato('Bici da corsa usata');
    expect(m).toMatch(/proposta/i);
    expect(m).not.toMatch(/modifica come preferisci/);
  });
});
