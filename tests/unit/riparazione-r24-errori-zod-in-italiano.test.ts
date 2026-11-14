import { describe, it, expect } from 'vitest';
import { z } from 'zod';
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

  // Giro di correzione — il limite escluso e il limite compreso non sono la stessa frase.
  it.each([
    ['Number must be greater than 0', 'Deve essere maggiore di 0'],
    ['Number must be less than 100', 'Deve essere minore di 100'],
    ['Number must be greater than or equal to 0', 'Valore minimo: 0'],
    ['String must contain over 5 character(s)', 'Almeno 6 caratteri'],
    ['String must contain under 5 character(s)', 'Massimo 4 caratteri'],
    ['Array must contain more than 1 element(s)', 'Seleziona almeno 2 elementi'],
  ])('«%s» → «%s»', (inglese, italiano) => {
    expect(comeLaPagina(inglese)).toBe(italiano);
  });

  it('i testi veri di Zod (in inglese, come da una rotta senza traduttore) arrivano con la frase giusta', () => {
    // La mappa inglese predefinita, passata alla singola validazione: è quello che risponde una rotta
    // dove il traduttore non è acceso.
    const inglese = (schema: z.ZodTypeAny, valore: unknown) =>
      schema.safeParse(valore, { errorMap: z.defaultErrorMap }).error?.issues[0]?.message ?? '';
    expect(inglese(z.number().positive(), 0)).toBe('Number must be greater than 0');
    expect(comeLaPagina(inglese(z.number().positive(), 0))).toBe('Deve essere maggiore di 0');
    expect(comeLaPagina(inglese(z.number().min(1), 0))).toBe('Valore minimo: 1');
    expect(comeLaPagina(inglese(z.number().lt(10), 10))).toBe('Deve essere minore di 10');
    expect(comeLaPagina(inglese(z.number().max(10), 11))).toBe('Valore massimo: 10');
  });

  it.each([
    "Expected 'a' | 'b', received number",
    'Invalid datetime',
    'Invalid cuid',
    'Invalid time',
    'Invalid function arguments',
  ])('«%s» non passa in inglese: esce la frase generica', (inglese) => {
    expect(comeLaPagina(inglese)).toBe('Uno dei dati inseriti non va bene: controllalo e riprova.');
  });

  it('i testi veri di Zod per un elenco col tipo sbagliato e per una data non valida', () => {
    const inglese = (schema: z.ZodTypeAny, valore: unknown) =>
      schema.safeParse(valore, { errorMap: z.defaultErrorMap }).error?.issues[0]?.message ?? '';
    const elenco = inglese(z.enum(['a', 'b']), 3);
    expect(elenco).toBe("Expected 'a' | 'b', received number");
    expect(comeLaPagina(elenco)).not.toMatch(/Expected|received/);
    const data = inglese(z.string().datetime(), 'ieri');
    expect(data).toBe('Invalid datetime');
    expect(comeLaPagina(data)).not.toMatch(/Invalid/);
  });

  it('le frasi italiane delle rotte restano quelle', () => {
    expect(comeLaPagina('Nome troppo lungo: massimo 120 caratteri')).toBe('Nome troppo lungo: massimo 120 caratteri');
  });
});
