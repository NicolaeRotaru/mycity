import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import '@/lib/zod-i18n';

/**
 * R04-003 — i quattro errori di Zod che restavano in inglese: l'unione («Invalid input»),
 * le chiavi non riconosciute, il literal sbagliato e il refine senza messaggio.
 * Schemi veri, traduttore vero.
 */
const messaggi = (r: { success: boolean; error?: z.ZodError }) => (r.error?.issues ?? []).map((i) => i.message);
const INGLESE = /invalid|unrecognized|expected|key\(s\)/i;

describe('gli errori di Zod che restavano in inglese', () => {
  it('un\'unione sbagliata (il caso dell\'«optional or literal vuoto»)', () => {
    const schema = z.string().max(8).optional().or(z.literal(''));
    const m = messaggi(schema.safeParse(42));
    expect(m).toEqual(['Valore non valido']);
    expect(m.join()).not.toMatch(INGLESE);
  });

  it('le chiavi non riconosciute di uno schema strict, una e più d\'una', () => {
    const schema = z.object({ nome: z.string() }).strict();
    expect(messaggi(schema.safeParse({ nome: 'a', extra: 1 }))).toEqual(['C’è un campo che non serve qui']);
    expect(messaggi(schema.safeParse({ nome: 'a', extra: 1, altro: 2 }))).toEqual(['Ci sono 2 campi che non servono qui']);
  });

  it('un literal sbagliato', () => {
    const m = messaggi(z.object({ accetto: z.literal(true) }).safeParse({ accetto: false }));
    expect(m).toEqual(['Valore non valido']);
  });

  it('un refine senza messaggio, ma quello con il suo messaggio resta il suo', () => {
    expect(messaggi(z.string().refine((v) => v.startsWith('IT')).safeParse('FR'))).toEqual(['Valore non valido']);
    expect(messaggi(z.string().superRefine((v, ctx) => { if (!v) ctx.addIssue({ code: z.ZodIssueCode.custom }); }).safeParse(''))).toEqual(['Valore non valido']);
    expect(messaggi(z.string().refine((v) => v.startsWith('IT'), { message: 'Deve cominciare con IT' }).safeParse('FR'))).toEqual(['Deve cominciare con IT']);
  });
});
