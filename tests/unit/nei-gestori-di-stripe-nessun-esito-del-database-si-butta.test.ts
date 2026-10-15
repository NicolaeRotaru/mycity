import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type ts from 'typescript';
import { cercaEsitiButtati, programmaDeiGestori, type Referto } from './aiuti/esiti-del-database-buttati';

/**
 * 15/10/2026 (R81, secondo giro di collaudo) — IL FRENO CHE NON GUARDA COME È
 * SCRITTA LA RIGA, MA CHE COSA VALE.
 *
 * Il controllo di stile riconosceva solo `await admin.from(..).update(..)` e
 * parenti. Il collaudatore ha messo nella cartella dei gestori sei forme della
 * stessa malattia e quattro sono passate senza un errore: scritture dentro
 * `Promise.all`, una funzione del database (`rpc`), un aiutante che
 * restituisce l'esito e viene ignorato, una richiesta costruita in due tempi.
 * Una di queste c'era già nel codice vero: la merce rimessa a scaffale nel
 * rimborso pieno, col risultato non letto.
 *
 * Qui il controllo chiede a TypeScript il tipo di ogni risultato buttato via.
 * Prima prova: le sei forme del collaudatore, messe in un file che esiste solo
 * in memoria dentro la cartella dei gestori, vengono prese tutte, e le forme
 * giuste no. Seconda prova: nel codice vero dei gestori non ce n'è nessuna, e
 * il controllo ha guardato davvero (un controllo che non esamina niente non è
 * un verde).
 */

const RADICE = process.cwd();
const CARTELLA = join(RADICE, 'lib/stripe/webhook');
const VERI = [
  ...readdirSync(CARTELLA).filter((f) => f.endsWith('.ts')).map((f) => join(CARTELLA, f)),
  join(RADICE, 'app/api/stripe/webhook/route.ts'),
];
const SONDA = join(CARTELLA, '__sonda_esiti_buttati__.ts');

const testa =
  `import type Stripe from 'stripe';\n` +
  `import { getAdminSupabase } from '@/lib/supabase/server';\n` +
  `import { applyConnectAccountStatus } from '@/lib/stripe/payout';\n` +
  `import { scritturaObbligatoria, scritturaFacoltativa } from './esito';\n`;

/** Una riga per caso: il numero di riga dice quale forma è stata presa. */
const CASI_SBAGLIATI = [
  `  await admin.from('orders').update({ dispute_status: 'OPEN' }).in('id', [id]);`,
  `  const { data: d1 } = await admin.from('orders').update({ a: 1 }).eq('id', id).select('id'); void d1;`,
  `  await Promise.all([id, id].map((x) => admin.from('orders').update({ a: 1 }).eq('id', x)));`,
  `  await admin.rpc('restore_stock_for_order', { p_order_id: id });`,
  `  await applyConnectAccountStatus(acct);`,
  `  const q = admin.from('orders').update({ a: 1 }); await q.eq('id', id);`,
  `  admin.from('notifications').insert({ user_id: id });`,
  `  const q2 = admin.from('orders').update({ a: 2 }); const { data: d2 } = await q2.select('id'); void d2;`,
];
const CASI_GIUSTI = [
  `  scritturaObbligatoria(await admin.from('orders').update({ a: 1 }).eq('id', id), 'x');`,
  `  scritturaFacoltativa(await admin.from('notifications').insert({ user_id: id }), 'y');`,
  `  const { error: e1 } = await admin.from('orders').update({ a: 2 }).eq('id', id); if (e1) throw e1;`,
  `  const { error: e2 } = await admin.rpc('restore_stock_for_order', { p_order_id: id }); if (e2) throw e2;`,
  `  const { data: righe } = await admin.from('orders').select('id').eq('id', id); void righe;`,
  `  scritturaObbligatoria(await applyConnectAccountStatus(acct), 'z');`,
];

function sonda(righe: string[]): string {
  return `${testa}export async function gestisci(id: string, acct: Stripe.Account) {\n  const admin = getAdminSupabase();\n${righe.join('\n')}\n}\n`;
}

let programma: ts.Program;
beforeAll(() => {
  programma = programmaDeiGestori(RADICE, VERI, {
    [SONDA]: sonda(CASI_SBAGLIATI),
    [`${SONDA}.giusti.ts`]: sonda(CASI_GIUSTI),
  });
}, 120_000);

describe('un esito del database buttato via, in qualunque forma', () => {
  it('LE SEI FORME DEL COLLAUDATORE (e due parenti) vengono prese tutte', () => {
    const referto = cercaEsitiButtati(programma, RADICE, [SONDA]);
    const righePrese = referto.trovati.map((t) => t.riga).sort((a, b) => a - b);
    // La prima riga dei casi è la 7 del file sonda (5 di testa, firma, admin).
    const attese = CASI_SBAGLIATI.map((_, i) => i + 7);
    expect(righePrese, `forme passate senza bocciatura: ${JSON.stringify(referto.trovati)}`).toEqual(attese);
  });

  it('le forme giuste passano: un freno che boccia il codice corretto qualcuno lo spegne', () => {
    const referto = cercaEsitiButtati(programma, RADICE, [`${SONDA}.giusti.ts`]);
    expect(referto.trovati).toEqual([]);
    expect(referto.esaminate, 'non ha guardato niente: non è un verde').toBeGreaterThanOrEqual(3);
  });
});

describe('nei gestori veri di Stripe', () => {
  let referto: Referto;
  beforeAll(() => {
    referto = cercaEsitiButtati(programma, RADICE, VERI);
  });

  it('nessun esito del database buttato via, e nessun risultato che il controllo non sa leggere', () => {
    expect(referto.trovati, JSON.stringify(referto.trovati, null, 1)).toEqual([]);
  });

  it('il controllo ha guardato davvero: tutti i file, e decine di risultati', () => {
    expect(referto.file).toBe(VERI.length);
    expect(VERI.length).toBeGreaterThanOrEqual(15);
    expect(referto.esaminate).toBeGreaterThan(40);
  });
});
