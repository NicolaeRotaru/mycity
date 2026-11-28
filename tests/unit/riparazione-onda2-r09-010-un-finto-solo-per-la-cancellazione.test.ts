import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';

/**
 * R09-010 — Le prove della cancellazione usano UN finto del database, quello che applica i filtri.
 *
 * tests/unit/minori-s08-cancellazione.test.ts aveva un `adminFinto()` scritto a mano: ogni lettura
 * rispondeva una lista fissa e le scritture registravano solo i loro filtri, quindi la prova «si
 * chiudono solo guida e promozioni» guardava l'elenco passato a `.in()`, non quali email restavano in
 * coda. Ora usa tests/unit/aiuti/finto-giro-notturno.ts, a cui servivano `.in()` e la scrittura che
 * torna le righe toccate (`update(...).select('id')`, come PostgREST).
 */

const radice = join(__dirname, '..', '..');

describe('R09-010 — un finto solo per le prove della cancellazione', () => {
  it('minori-s08-cancellazione usa il finto unico e non se ne scrive uno suo', () => {
    const src = readFileSync(join(radice, 'tests/unit/minori-s08-cancellazione.test.ts'), 'utf8');
    expect(src).toMatch(/import\s*\{[^}]*\bfintoGiroNotturno\b[^}]*\}\s*from\s*'\.\/aiuti\/finto-giro-notturno'/);
    expect(src).not.toMatch(/function adminFinto\b/);
    expect(src, 'un finto di Supabase scritto a mano').not.toMatch(/from\s*\(\s*tabella\s*:\s*string\s*\)\s*\{/);
    expect(src).toMatch(/getAdminSupabase:[\s\S]{0,160}stato\.finto\.admin/);
  });

  it('il finto unico applica .in(): passano le righe con la colonna in elenco, NULL no', async () => {
    const f = fintoGiroNotturno({
      tabelle: {
        email_queue: [
          { id: 'a', template: 'first_order_promo' },
          { id: 'b', template: 'order_ready' },
          { id: 'c', template: null },
        ],
      },
    });
    const { data } = await f.admin.from('email_queue').select('id').in('template', ['first_order_promo', 'welcome']);
    expect((data ?? []).map((r) => r.id)).toEqual(['a']);
  });

  it('una scrittura seguita da .select() si fa e torna le righe toccate, come PostgREST', async () => {
    const f = fintoGiroNotturno({ tabelle: { profiles: [{ id: 'u-1', deletion_requested_at: null }, { id: 'u-2', deletion_requested_at: 'x' }] } });
    const scritte = await f.admin
      .from('profiles')
      .update({ deletion_requested_at: 'oggi' })
      .is('deletion_requested_at', null)
      .select('id');
    expect((scritte.data ?? []).map((r) => r.id)).toEqual(['u-1']);
    expect(f.righe('profiles').map((r) => r.deletion_requested_at)).toEqual(['oggi', 'x']);
    expect(f.diario).toContainEqual({ op: 'update', tabella: 'profiles', valori: { deletion_requested_at: 'oggi' }, toccate: 1 });
  });
});
