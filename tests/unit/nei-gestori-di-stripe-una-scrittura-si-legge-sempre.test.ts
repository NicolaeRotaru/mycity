import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

/**
 * 15/10/2026 (R81) — IL FRENO CHE CHIUDE LA CLASSE, NON SOLO I CASI TROVATI.
 *
 * Le scritture col risultato non letto, nei gestori degli avvisi di Stripe,
 * erano diciassette (più tre nella rotta). Ripararle una per una non basta: la
 * diciottesima arriva col prossimo gestore. Il controllo di stile della casa
 * (`.eslintrc.json`, cartella `lib/stripe/webhook` e rotta del webhook) adesso
 * rifiuta una scrittura lasciata senza `scritturaObbligatoria` o
 * `scritturaFacoltativa`, o senza leggere `{ error }`.
 *
 * Questa prova non legge il file di configurazione: fa girare il controllo
 * VERO, con la configurazione vera, su pezzetti di codice messi nella cartella
 * dei gestori, e guarda cosa risponde. Gli stessi pezzetti fuori da quella
 * cartella non vengono toccati: il freno vale dove passano i soldi di Stripe.
 */

type MessaggioLint = { ruleId: string | null; message: string; severity: number };
type Controllo = {
  lintText(codice: string, opzioni: { filePath: string }): Promise<Array<{ messages: MessaggioLint[] }>>;
};
const richiedi = createRequire(import.meta.url);
const { ESLint } = richiedi('eslint') as { ESLint: new (o: { cwd: string }) => Controllo };
const eslint = new ESLint({ cwd: process.cwd() });

const NEL_WEBHOOK = 'lib/stripe/webhook/prova-del-freno.ts';

async function bocciature(codice: string, percorso = NEL_WEBHOOK): Promise<string[]> {
  const [esito] = await eslint.lintText(codice, { filePath: percorso });
  return (esito?.messages ?? [])
    .filter((m) => m.severity === 2 && m.ruleId === 'no-restricted-syntax')
    .map((m) => m.message);
}

const gestore = (corpo: string) =>
  `import { getAdminSupabase } from '@/lib/supabase/server';\n` +
  `import { scritturaObbligatoria, scritturaFacoltativa } from './esito';\n` +
  `export async function gestisci(id: string) {\n  const admin = getAdminSupabase();\n${corpo}\n}\n`;

describe('una scrittura nei gestori di Stripe col risultato non letto non passa', () => {
  it('IL CASO DELLA SCHEDA — la contestazione scritta e dimenticata', async () => {
    const trovate = await bocciature(
      gestore(`  await admin.from('orders').update({ dispute_status: 'OPEN' }).in('id', [id]);`),
    );
    expect(trovate.join(' · '), 'una scrittura il cui errore non legge nessuno è passata').toMatch(/R81/);
  }, 30000);

  it('nemmeno un inserimento secco o una catena di filtri lunga', async () => {
    expect(await bocciature(gestore(`  await admin.from('notifications').insert({ user_id: id });`))).toHaveLength(1);
    expect(
      await bocciature(gestore(`  await admin.from('orders').update({ a: 1 }).eq('id', id).eq('b', 2).or('c.is.null');`)),
    ).toHaveLength(1);
  }, 30000);

  it('nemmeno chi legge i dati e lascia l errore per terra', async () => {
    const trovate = await bocciature(
      gestore(`  const { data } = await admin.from('profiles').update({ a: 1 }).eq('id', id).select('id');\n  return data;`),
    );
    expect(trovate).toHaveLength(1);
  }, 30000);

  it('le due forme ammesse, e chi legge l errore da sé, passano', async () => {
    const trovate = await bocciature(
      gestore(
        `  scritturaObbligatoria(await admin.from('orders').update({ a: 1 }).eq('id', id), 'x');\n` +
          `  scritturaFacoltativa(await admin.from('notifications').insert({ user_id: id }), 'y');\n` +
          `  const { error } = await admin.from('orders').update({ a: 2 }).eq('id', id);\n` +
          `  if (error) throw new Error(error.message);\n` +
          `  const { data: righe } = await admin.from('orders').select('id').eq('id', id);\n` +
          `  return righe;`,
      ),
    );
    expect(trovate, 'il freno boccia anche il codice giusto: diventa impraticabile e qualcuno lo spegne').toEqual([]);
  }, 30000);

  it('fuori dai gestori di Stripe lo stesso codice non viene toccato', async () => {
    const trovate = await bocciature(
      gestore(`  await admin.from('orders').update({ a: 1 }).eq('id', id);`),
      'lib/prova-fuori-dal-webhook.ts',
    );
    expect(trovate).toEqual([]);
  }, 30000);
});
