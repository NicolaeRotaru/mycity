import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * 22/8/2026 — UN COOKIE CHE NON SI DICHIARA SEMBRA NASCOSTO.
 *
 * `mc_ruolo` veniva impostato dal middleware su ogni visita e non compariva
 * nell'informativa. Non è un cookie di profilazione — è tecnico, dura dieci
 * minuti, è firmato — e per quello non serve il consenso. Ma va scritto lo
 * stesso: l'informativa dice quali cookie usa il sito, e se ne salta uno chi
 * la legge non ha modo di saperlo.
 *
 * Questo guardiano estrae dal codice i nomi dei cookie impostati e pretende
 * che ognuno compaia nella pagina /cookies. Metti un cookie nuovo senza
 * dichiararlo e diventa rosso.
 */

const RADICE = join(__dirname, '..', '..');
const POLICY = join(RADICE, 'app', 'cookies', 'page.tsx');

/**
 * Cookie che non impostiamo noi: li mette il fornitore, e nell'informativa ci
 * sono già come terza parte.
 */
const NON_NOSTRI = new Set(['__cf_bm', '__stripe_mid', '__stripe_sid']);

function sorgenti(dir: string, dentro: string[] = []): string[] {
  for (const voce of readdirSync(dir)) {
    if (voce === 'node_modules' || voce.startsWith('.')) continue;
    const percorso = join(dir, voce);
    if (statSync(percorso).isDirectory()) sorgenti(percorso, dentro);
    else if (/\.(ts|tsx)$/.test(voce)) dentro.push(percorso);
  }
  return dentro;
}

describe('ogni cookie che mettiamo è dichiarato nell’informativa', () => {
  const policy = readFileSync(POLICY, 'utf8');
  const file = ['app', 'lib', 'components'].flatMap((c) => sorgenti(join(RADICE, c)));
  const middleware = join(RADICE, 'middleware.ts');

  it('nessun cookie impostato dal codice manca dalla pagina /cookies', () => {
    const trovati = new Map<string, string>();

    for (const f of [...file, middleware]) {
      const testo = readFileSync(f, 'utf8');
      // `cookies.set({ name: 'x' … })` e `cookies.set('x', …)`
      for (const m of testo.matchAll(/cookies\.set\(\s*\{\s*name:\s*['"`]([^'"`]+)['"`]/g)) {
        trovati.set(m[1], relative(RADICE, f));
      }
      for (const m of testo.matchAll(/cookies\.set\(\s*['"`]([^'"`]+)['"`]\s*,/g)) {
        trovati.set(m[1], relative(RADICE, f));
      }
    }

    const mancanti: string[] = [];
    for (const [nome, dove] of trovati) {
      if (NON_NOSTRI.has(nome)) continue;
      // I cookie di Supabase hanno un nome variabile: nell'informativa stanno
      // come `sb-*-auth-token`.
      if (nome.startsWith('sb-')) continue;
      if (!policy.includes(nome)) mancanti.push(`${nome}  (impostato in ${dove})`);
    }

    expect(
      mancanti,
      'Questi cookie li mette il nostro codice e non compaiono in app/cookies/page.tsx. ' +
        'Un cookie che non si dichiara sembra nascosto, anche quando è tecnico:\n  ' +
        mancanti.join('\n  '),
    ).toEqual([]);
  });

  it('il controllo guarda davvero: qualche cookie lo trova', () => {
    const testo = readFileSync(middleware, 'utf8');
    expect(testo).toContain('mc_ruolo');
    expect(policy).toContain('mc_ruolo');
  });

  it('mc_vid viaggia con secure: non si legge su una rete aperta', () => {
    const track = readFileSync(join(RADICE, 'app', 'api', 'track', 'route.ts'), 'utf8');
    const blocco = track.slice(track.indexOf('name: VID_COOKIE'));
    const fine = blocco.indexOf('});');
    expect(blocco.slice(0, fine)).toContain('secure: true');
  });
});
