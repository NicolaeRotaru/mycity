import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 30/8/2026 (R004) — «npm run verify» RESTAVA VERDE ANCHE SE UNA COLONNA SPARIVA.
 *
 * I tipi del database ci sono, sono quasi tremila righe generate dalle
 * migrazioni, e fino a oggi non li importava nessun file di produzione: ogni
 * pagina si riscriveva a mano la forma delle righe che leggeva. Cosi' una
 * colonna rinominata o tolta non rompeva niente a compilazione — rompeva la
 * lettura in produzione, e la pagina usciva vuota senza dire perche'. E'
 * successo davvero con `orders.buyer_id`: una colonna che su quella tabella non
 * esiste, l'esportazione dei dati usciva senza gli ordini e diceva che era
 * andata bene.
 *
 * Tipizzare i client Supabase tutti insieme fa 310 errori (provato) e non e' un
 * lavoro da fare di corsa sui pagamenti. Le pagine di questo lotto pero' adesso
 * DERIVANO la forma delle righe dai tipi generati (`lib/db-rows`).
 *
 * Questa prova lo verifica facendo sparire per davvero una colonna: prende i
 * tipi generati, ne toglie `store_name` dalla tabella dei profili, e ricompila
 * le pagine contro quella versione mutilata. Se le pagine sono ancora ancorate
 * allo schema il compilatore protesta, e la prova passa. Se qualcuno torna a
 * scriversi la forma a mano, la compilazione va a buon fine — e questa prova
 * diventa rossa.
 */

/** Le pagine che devono accorgersi della colonna sparita. */
const PAGINE_ANCORATE = [
  'app/admin/orders/page.tsx',
  'app/admin/products/page.tsx',
  'app/promozioni/page.tsx',
];

const ALTRE_INCLUSE = [
  'app/admin/cod-remittance/page.tsx',
  'components/StoreFeaturedStrip.tsx',
];

describe('le pagine ancorate allo schema del database', () => {
  it('non compilano piu se una colonna sparisce dai tipi generati', () => {
    const cartella = '.prova-colonna-sparita';
    rmSync(cartella, { recursive: true, force: true });
    mkdirSync(cartella);
    try {
      // 1. I tipi veri, meno una colonna: e' la mutazione.
      const tipi = readFileSync('lib/database.types.ts', 'utf8');
      const riga = '          store_name: string | null;\n';
      expect(
        tipi.split(riga).length - 1,
        'i tipi generati sono cambiati di forma: questa prova non sa piu quale colonna far sparire',
      ).toBe(1);
      writeFileSync(join(cartella, 'database.types.ts'), tipi.replace(riga, ''), 'utf8');

      // 2. Un progetto TypeScript che vede le pagine e i tipi mutilati.
      //    `components/GoogleAnalytics.tsx` porta con se' la dichiarazione di
      //    `window.gtag`, senza la quale uscirebbero errori che non c'entrano.
      writeFileSync(
        join(cartella, 'tsconfig.json'),
        JSON.stringify({
          extends: '../tsconfig.json',
          compilerOptions: {
            noEmit: true,
            incremental: false,
            paths: { '@/lib/database.types': ['./database.types.ts'], '@/*': ['../*'] },
          },
          include: [
            '../next-env.d.ts',
            '../types/**/*.d.ts',
            '../components/GoogleAnalytics.tsx',
            ...PAGINE_ANCORATE.map((f) => `../${f}`),
            ...ALTRE_INCLUSE.map((f) => `../${f}`),
          ],
        }),
        'utf8',
      );

      // 3. Il compilatore deve protestare, e deve protestare per la colonna.
      let uscita = '';
      let haFallito = false;
      try {
        execFileSync('npx', ['tsc', '-p', join(cartella, 'tsconfig.json')], { encoding: 'utf8', stdio: 'pipe' });
      } catch (e) {
        haFallito = true;
        uscita = `${(e as { stdout?: string }).stdout ?? ''}${(e as { stderr?: string }).stderr ?? ''}`;
      }

      expect(
        haFallito,
        'una colonna sparita dallo schema non rompe piu la compilazione: le pagine se la sono riscritta a mano, e il giorno che sparisce davvero se ne accorge il cliente',
      ).toBe(true);

      for (const pagina of PAGINE_ANCORATE) {
        const righe = uscita.split('\n').filter((r) => r.startsWith(pagina) && r.includes('TS2344'));
        expect(
          righe.length,
          `«${pagina}» non si e accorta che la colonna store_name non esiste piu. Il compilatore ha detto:\n${uscita.slice(0, 2000)}`,
        ).toBeGreaterThan(0);
      }
    } finally {
      rmSync(cartella, { recursive: true, force: true });
    }
  }, 60_000);
});
