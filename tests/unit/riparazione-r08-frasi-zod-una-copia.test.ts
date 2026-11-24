import { describe, it, expect } from 'vitest';

/**
 * R08-005. Le frasi italiane di Zod stavano in due copie: lib/zod-frasi.ts (senza Zod, la legge
 * lib/errors.ts che entra in ogni pagina dal piede del sito) e lib/zod-i18n.ts (col traduttore).
 * Due copie si possono staccare: il traduttore dice una frase, il testo che arriva dal server
 * un'altra. Adesso e' una copia sola: chi la importa da una parte o dall'altra ha lo stesso oggetto.
 */
import { FRASI_ZOD as daTraduttore } from '@/lib/zod-i18n';
import { FRASI_ZOD as daFrasi } from '@/lib/zod-frasi';

describe('R08-005 le frasi di Zod sono una copia sola', () => {
  it('importate dal traduttore o da zod-frasi sono lo stesso oggetto', () => {
    expect(daTraduttore).toBe(daFrasi);
  });

  it('e dicono le frasi italiane di sempre', () => {
    expect(daTraduttore.obbligatorio).toBe('Campo obbligatorio');
    expect(daTraduttore.tipo('number')).toBe('Valore non valido: serve un numero');
    expect(daTraduttore.almenoElementi(1)).toBe('Seleziona almeno 1 elemento');
    expect(daTraduttore.massimoCaratteri(3)).toBe('Massimo 3 caratteri');
  });
});
