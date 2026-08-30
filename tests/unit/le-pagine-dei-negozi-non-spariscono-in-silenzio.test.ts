/**
 * 27/8/2026 (R010) — NOVE PUNTI CHE, SENZA LE VARIABILI DI SUPABASE, TACEVANO.
 *
 * Le pagine che costruiscono i metadati — negozio, prodotto, categoria, profilo pubblico — si
 * facevano il collegamento al database a mano: leggevano `process.env` grezzo e, se mancava
 * qualcosa, `return null`. Da fuori quel `null` è indistinguibile da «questo negozio non esiste»:
 * Google riceveva «Negozio non trovato» con `noindex` su schede vere, senza un errore nei log e
 * senza un allarme. Le pagine dei negozi sparivano dalla ricerca e nessuno poteva accorgersene.
 *
 * La fabbrica unica del client (`lib/supabase/anonimo.ts`) esiste dal 22 agosto proprio per questo:
 * quando le variabili mancano LANCIA, e dice quali. Una pagina che si rompe rumorosamente si
 * aggiusta in un'ora.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { leggiPerMetadati, dimenticaLettureDeiMetadati } from '@/lib/supabase/lettura-per-metadati';
import type { SupabaseClient } from '@supabase/supabase-js';

function fintoClient(risposta: { data: unknown; error: unknown }) {
  const query = { eq: () => query, single: async () => risposta };
  return { from: () => ({ select: () => query }) } as unknown as SupabaseClient;
}

describe('la lettura che alimenta i metadati', () => {
  beforeEach(() => { dimenticaLettureDeiMetadati(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

  it('senza le variabili di Supabase si ferma e dice quali mancano', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');

    await expect(
      leggiPerMetadati('seller_public_profiles', 'id, store_name', { id: 'n-1' }),
    ).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('con la riga in mano la restituisce', async () => {
    const riga = { id: 'n-1', store_name: 'Pane Quotidiano' };
    const letta = await leggiPerMetadati<typeof riga>(
      'seller_public_profiles', 'id, store_name', { id: 'n-1' }, fintoClient({ data: riga, error: null }),
    );
    expect(letta).toEqual(riga);
  });

  it('una riga che non esiste resta null: quello sì che è «non trovato»', async () => {
    const letta = await leggiPerMetadati(
      'seller_public_profiles', 'id, store_name', { id: 'mai-esistito' },
      fintoClient({ data: null, error: { code: 'PGRST116' } }),
    );
    expect(letta).toBeNull();
  });
});

describe('sotto app/ non ci si costruisce più il client a mano', () => {
  it('nessun createClient scritto a mano fuori dalle rotte', () => {
    // Controllo di struttura: i nove punti erano tutti sotto `app/`, fuori dalle API. Le rotte
    // API hanno le loro fabbriche (server, admin, gettone) e non c'entrano.
    const trovati = execSync(
      "grep -rn \"createClient(\" app/ --include=*.tsx --include=*.ts | grep -v '/api/' || true",
      { encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean);
    expect(trovati, 'un altro punto che legge le variabili a mano e tace se mancano').toEqual([]);
  });

  it('e nessuno risponde più «non trovato» quando manca una variabile', () => {
    for (const f of [
      'app/store/[id]/layout.tsx',
      'app/store/[id]/[slug]/layout.tsx',
      'app/product/[id]/layout.tsx',
      'app/category/[slug]/layout.tsx',
      'app/u/[handle]/page.tsx',
    ]) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f} controlla ancora le variabili a mano`).not.toContain('process.env.NEXT_PUBLIC_SUPABASE_URL');
    }
  });
});

/**
 * 27/8/2026 (R082) — LA RIGA DEL PRODOTTO LETTA DUE VOLTE PER OGNI APERTURA DI SCHEDA.
 *
 * `app/product/[id]/layout.tsx` chiama la stessa lettura due volte nello stesso giro di richiesta:
 * una per i metadati (titolo, anteprima da condividere) e una per il contenuto. Erano due letture
 * vere, sulla pagina più aperta del sito, e si pagano in tempo di risposta.
 *
 * In React 19 basterebbe `cache()`, ma qui React è ancora il 18 e quella funzione non esiste
 * (`typeof React.cache === 'undefined'`): la memoria dura due secondi, molto meno dei cinque minuti
 * che quelle pagine già dichiarano con `revalidate`.
 *
 * ⚠️ Resta aperta la TERZA lettura, quella che la scheda rifà dal browser: per toglierla serve
 * passare la riga alla pagina come dato iniziale, cioè il lavoro di precaricamento che è un'altra
 * scheda del cantiere.
 */
describe('la stessa riga chiesta due volte nello stesso giro', () => {
  beforeEach(() => { dimenticaLettureDeiMetadati(); });
  afterEach(() => { vi.useRealTimers(); });

  function clientCheConta() {
    let letture = 0;
    const query = { eq: () => query, single: async () => { letture += 1; return { data: { id: 'p-1', name: 'Pane' }, error: null }; } };
    return { letture: () => letture, client: { from: () => ({ select: () => query }) } as unknown as SupabaseClient };
  }

  it('arriva al database una volta sola', async () => {
    const c = clientCheConta();
    const uno = await leggiPerMetadati('products', 'id, name', { id: 'p-1' }, c.client);
    const due = await leggiPerMetadati('products', 'id, name', { id: 'p-1' }, c.client);

    expect(uno).toEqual(due);
    expect(c.letture(), 'la stessa riga letta due volte per ogni apertura di scheda').toBe(1);
  });

  it('ma un altro prodotto è un altra domanda', async () => {
    const c = clientCheConta();
    await leggiPerMetadati('products', 'id, name', { id: 'p-1' }, c.client);
    await leggiPerMetadati('products', 'id, name', { id: 'p-2' }, c.client);
    expect(c.letture()).toBe(2);
  });

  it('e passata la finestra si torna a chiedere al database', async () => {
    // La memoria è per la singola richiesta, non una cache: due secondi e si ricomincia.
    vi.useFakeTimers();
    const c = clientCheConta();
    await leggiPerMetadati('products', 'id, name', { id: 'p-1' }, c.client);
    vi.advanceTimersByTime(3_000);
    await leggiPerMetadati('products', 'id, name', { id: 'p-1' }, c.client);
    expect(c.letture(), 'una riga vecchia di ore mostrata come fresca').toBe(2);
  });
});
