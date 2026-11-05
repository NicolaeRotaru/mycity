import { describe, expect, it } from 'vitest';
import { spiegaIlCollegamentoFallito, spiegaIlRegistroIlleggibile } from '@/scripts/check-migration-drift.mjs';

/** S03 — i messaggi del controllo della deriva (schede 2656, 1664). */
const POOLER = 'postgresql://postgres.abcdefghij:UnaPasswordLunga99@aws-1-eu-west-1.pooler.supabase.com:5432/postgres';

describe('controllo della deriva', () => {
  it('2656 — il pooler che rifiuta (ECONNREFUSED) non manda a guardare la password', () => {
    const errore = Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:5432'), { code: 'ECONNREFUSED' });
    const testo = (spiegaIlCollegamentoFallito(errore, POOLER) as string[]).join('\n');
    expect(testo).toMatch(/La password non c'entra/);
    expect(testo).not.toMatch(/controlla porta \(5432\) e password/);
    expect(testo).not.toContain('UnaPasswordLunga99');
  });

  it('1664 — registro assente o non leggibile: una frase che dice cosa fare', () => {
    const assente = (spiegaIlRegistroIlleggibile({ code: '42P01', message: 'relation "supabase_migrations.schema_migrations" does not exist' }) as string[]).join('\n');
    expect(assente).toMatch(/non ha il registro delle migrazioni di Supabase/);
    const negato = (spiegaIlRegistroIlleggibile({ code: '42501', message: 'permission denied for schema supabase_migrations' }) as string[]).join('\n');
    expect(negato).toMatch(/usa l'utente postgres del progetto/);
  });
});
