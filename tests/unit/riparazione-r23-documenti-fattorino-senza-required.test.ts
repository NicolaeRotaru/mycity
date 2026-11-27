import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { documentiObbligatoriDelFattorino } from '@/lib/admin/regole-approvazione';

/**
 * R23-009 — Nell'elenco DOCS dell'iscrizione del fattorino non resta un «required» che nessuno legge.
 *
 * Patente e polizza avevano `required: true`, ma chi va in bici non le deve caricare: l'asterisco e
 * il controllo «tutti caricati» vengono da obbligatorio(), cioè dalla regola per mezzo
 * (documentiObbligatoriDelFattorino). Il campo era un dato morto che diceva il contrario.
 */
const SORGENTE = readFileSync(join(process.cwd(), 'app', 'rider', 'onboarding', 'page.tsx'), 'utf8');

function blocco(inizio: string, fine: string): string {
  const da = SORGENTE.indexOf(inizio);
  expect(da, `controprova: «${inizio}» deve esserci`).toBeGreaterThanOrEqual(0);
  return SORGENTE.slice(da, SORGENTE.indexOf(fine, da) + fine.length);
}

describe('R23-009 — l\'elenco dei documenti del fattorino non dice cose che nessuno legge', () => {
  it('il tipo DocDef e le righe di DOCS non hanno più il campo required', () => {
    expect(blocco('type DocDef =', '};')).not.toMatch(/\brequired\b/);
    expect(blocco('const DOCS: DocDef[] = [', '];')).not.toMatch(/\brequired\b/);
  });

  it('l\'asterisco e il «tutti caricati» vengono dalla regola per mezzo', () => {
    expect(SORGENTE).toMatch(/const obbligatorio = \(d: DocDef\) => colonneObbligatorie\.has\(/);
    expect(SORGENTE).toMatch(/DOCS\.filter\(obbligatorio\)/);
    expect(SORGENTE).toMatch(/\{obbligatorio\(d\) && <span[^>]*>\*<\/span>\}/);
  });

  it('controprova: in bici la patente non è obbligatoria, quindi «required: true» ingannava', () => {
    expect(documentiObbligatoriDelFattorino('BIKE').map((d) => d.colonna)).not.toContain('rider_license_url');
    expect(documentiObbligatoriDelFattorino('SCOOTER').map((d) => d.colonna)).toContain('rider_license_url');
  });
});
