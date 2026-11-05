import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * 5/11/2026 (S04) — La migrazione 215 raccoglie le correzioni minori del database. Il comportamento
 * lo prova tests/sql/rls/48 su un database ricostruito; qui si tiene fermo quello che la prova SQL
 * non vede: il ritorno indietro delle 157, 158 e 159, che nei loro file mancava (scheda 1623).
 */
const sql = readFileSync('migrations/215_minori_s04_database.sql', 'utf8');

describe('la migrazione 215', () => {
  it('annota com’era il secchio cod-proof prima della 157, e come tornarci (1623)', () => {
    expect(sql).toMatch(/RITORNO INDIETRO DELLE 157, 158 E 159/);
    expect(sql).toMatch(/UPDATE storage\.buckets SET file_size_limit = NULL, allowed_mime_types = NULL\s*\n--\s*WHERE id = 'cod-proof'/);
  });

});
