import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import '@/lib/zod-i18n';

/**
 * R07-004 (onda 2, 28/11/2026) — ALCUNI ERRORI DI ZOD RESTAVANO IN INGLESE.
 *
 * Il traduttore (lib/zod-i18n) non conosceva discriminatedUnion, multipleOf, finite, startsWith e
 * datetime: lì rispondeva col testo predefinito di Zod («Invalid discriminator value. Expected
 * 'a' | 'b'», «Number must be a multiple of 0.01», «Number must be finite», «Invalid input: must
 * start with "IT"», «Invalid datetime»). E qualunque caso senza una frase sua ricadeva sul testo
 * inglese. Schemi veri, traduttore vero.
 */
const messaggi = (r: { success: boolean; error?: z.ZodError }) => (r.error?.issues ?? []).map((i) => i.message);
const INGLESE = /\b(invalid|expected|must|number|string|input|received|datetime|discriminator)\b/i;

describe('R07-004 · gli errori di Zod che restavano in inglese', () => {
  it('discriminatedUnion con un tipo che non c’è: la scelta, senza le chiavi interne', () => {
    const schema = z.discriminatedUnion('tipo', [
      z.object({ tipo: z.literal('ritiro') }),
      z.object({ tipo: z.literal('consegna'), indirizzo: z.string() }),
    ]);
    const m = messaggi(schema.safeParse({ tipo: 'drone' }));
    expect(m).toEqual(['Valore non valido: scegline uno fra quelli proposti']);
    expect(m.join()).not.toMatch(INGLESE);
  });

  it('multipleOf: il passo detto in italiano, con la virgola', () => {
    expect(messaggi(z.number().multipleOf(0.5).safeParse(0.3))).toEqual(['Deve essere un multiplo di 0,5']);
    expect(messaggi(z.number().multipleOf(5).safeParse(7))).toEqual(['Deve essere un multiplo di 5']);
  });

  it('finite: infinito non è un numero valido', () => {
    const m = messaggi(z.number().finite().safeParse(Infinity));
    expect(m).toEqual(['Serve un numero valido']);
  });

  it('startsWith, endsWith e includes', () => {
    expect(messaggi(z.string().startsWith('IT').safeParse('FR76'))).toEqual(['Deve iniziare con «IT»']);
    expect(messaggi(z.string().endsWith('.pdf').safeParse('fattura.doc'))).toEqual(['Deve finire con «.pdf»']);
    expect(messaggi(z.string().includes('@').safeParse('nicola'))).toEqual(['Deve contenere «@»']);
  });

  it('datetime, date, time e una data che non esiste', () => {
    expect(messaggi(z.string().datetime().safeParse('ieri sera'))).toEqual(['Data non valida']);
    expect(messaggi(z.string().date().safeParse('31/02'))).toEqual(['Data non valida']);
    expect(messaggi(z.string().time().safeParse('le nove'))).toEqual(['Orario non valido']);
    expect(messaggi(z.date().safeParse(new Date('non una data')))).toEqual(['Data non valida']);
  });

  it('una data fuori dai limiti dice il giorno, all’italiana', () => {
    const schema = z.date().min(new Date('2026-11-28T12:00:00Z')).max(new Date('2026-12-31T12:00:00Z'));
    expect(messaggi(schema.safeParse(new Date('2026-01-01T12:00:00Z')))).toEqual(['La data deve essere dal 28/11/2026 in poi']);
    expect(messaggi(schema.safeParse(new Date('2027-01-01T12:00:00Z')))).toEqual(['La data deve essere entro il 31/12/2026']);
  });

  it('le altre validazioni di testo e i limiti su bigint e insiemi non escono in inglese', () => {
    const casi: Array<[z.ZodTypeAny, unknown]> = [
      [z.string().ip(), 'non-un-ip'],
      [z.string().cuid(), '!!'],
      [z.string().emoji(), 'ciao'],
      [z.string().base64(), '***'],
      [z.bigint().min(BigInt(10)), BigInt(5)],
      [z.bigint().max(BigInt(10)), BigInt(50)],
      [z.set(z.string()).min(2), new Set(['a'])],
      [z.set(z.string()).max(1), new Set(['a', 'b'])],
      [z.object({ a: z.string() }).and(z.object({ a: z.number() })), { a: 'x' }],
    ];
    for (const [schema, valore] of casi) {
      const m = messaggi(schema.safeParse(valore));
      expect(m.length, String(valore)).toBeGreaterThan(0);
      expect(m.join(' | '), String(valore)).not.toMatch(INGLESE);
    }
  });
});
