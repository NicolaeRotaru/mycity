import { describe, it, expect } from 'vitest';
import { apiErrorMessage, friendlyError } from '@/lib/errors';

/**
 * 13/11/2026 (R24-007) — IL TESTO INGLESE DI ZOD NON ARRIVA PIÙ AL CLIENTE.
 *
 * Quattordici rotte validano con Zod e rispondono `parsed.error.issues[0].message`.
 * Dove il traduttore non è acceso sul server, quel messaggio è il testo predefinito
 * inglese, e le pagine fanno `friendlyError(new Error(apiErrorMessage(body)))`: il
 * filtro finale lo lasciava passare («String must contain at most 120 character»,
 * con le parentesi tolte). Adesso esce con le frasi del traduttore italiano.
 */
const comeLaPagina = (message: string) =>
  friendlyError(new Error(apiErrorMessage({ ok: false, error: { code: 'INVALID_REQUEST', message } }, 'Invio non riuscito')));

describe('i testi predefiniti di Zod escono in italiano', () => {
  it.each([
    ['String must contain at most 120 character(s)', 'Massimo 120 caratteri'],
    ['String must contain at least 1 character(s)', 'Campo obbligatorio'],
    ['String must contain at least 10 character(s)', 'Almeno 10 caratteri'],
    ['Required', 'Campo obbligatorio'],
    ['Expected number, received string', 'Valore non valido: serve un numero'],
    ['Number must be less than or equal to 5', 'Valore massimo: 5'],
    ['Number must be greater than or equal to 1', 'Valore minimo: 1'],
    ['Array must contain at least 1 element(s)', 'Seleziona almeno 1 elemento'],
    ['Invalid url', 'URL non valido'],
  ])('«%s» → «%s»', (inglese, italiano) => {
    expect(comeLaPagina(inglese)).toBe(italiano);
  });

  it('«Invalid email» esce in italiano (la frase è quella degli errori di accesso)', () => {
    expect(comeLaPagina('Invalid email')).toMatch(/^[^a-z]*\S.*email non .*valid/i);
    expect(comeLaPagina('Invalid email')).not.toMatch(/^Invalid/);
  });

  it('un valore fuori elenco non mostra le chiavi interne', () => {
    const msg = comeLaPagina("Invalid enum value. Expected 'valore_a' | 'valore_b', received 'c'");
    expect(msg).not.toMatch(/Invalid|valore_a|Expected/);
  });

  it('un testo di Zod senza frase pronta non passa in inglese', () => {
    const msg = comeLaPagina('String must contain exactly 5 character(s)');
    expect(msg).not.toMatch(/String must|character/);
  });

  it('le frasi italiane delle rotte restano quelle', () => {
    expect(comeLaPagina('Nome troppo lungo: massimo 120 caratteri')).toBe('Nome troppo lungo: massimo 120 caratteri');
  });
});
