/**
 * 31/8/2026 (R102) — IL CANCELLO DELL'ACCESSIBILITA' SI SPEGNEVA DA SOLO, E
 * RESTAVA VERDE.
 *
 * La Dichiarazione di Accessibilita' pubblica promette la conformita' allo
 * European Accessibility Act, e l'unica prova che la puo' smentire e' axe che
 * gira in CI. Solo che axe viveva dentro il lavoro «E2E smoke (Playwright)»,
 * dove ogni passo era scritto cosi':
 *
 *     if: steps.e2e.outputs.enabled == 'true'
 *
 * e quel `enabled` diventa `false` quando mancano i segreti di un Supabase di
 * prova — che non ci sono mai stati. Nell'esecuzione 33053827261 su `main` il
 * lavoro risultava SUCCESS con «Install Playwright», «Build» e «Start app +
 * run e2e» tutti SKIPPED: la spunta verde diceva «provato» e nessun browser si
 * era aperto.
 *
 * Queste prove leggono il lavoro della CI come lo legge GitHub — lavori, passi
 * e condizioni — e chiedono una cosa sola: che esista un lavoro che fa girare
 * axe e che NIENTE, dentro quel lavoro, sia appeso a una condizione. La prima
 * prova gira sulla forma vera del 30/8/2026 e pretende che il controllo la
 * bocci: un controllo che non sa riconoscere il difetto da cui nasce non
 * protegge nessuno.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SPEC_ACCESSIBILITA = 'tests/e2e/11-a11y-percorso-acquisto.spec.ts';

type Passo = { nome: string; testo: string };
type Lavoro = { id: string; testo: string; passi: Passo[] };

function componiLavoro(id: string, righe: string[]): Lavoro {
  const passi: Passo[] = [];
  let passo: { nome: string; righe: string[] } | null = null;
  for (const riga of righe) {
    if (/^ {6}- /.test(riga)) {
      if (passo) passi.push({ nome: passo.nome, testo: passo.righe.join('\n') });
      const nome = /^ {6}- name:\s*(.*)$/.exec(riga)?.[1]?.trim() ?? '(passo senza nome)';
      passo = { nome, righe: [riga] };
      continue;
    }
    if (passo) passo.righe.push(riga);
  }
  if (passo) passi.push({ nome: passo.nome, testo: passo.righe.join('\n') });
  return { id, testo: righe.join('\n'), passi };
}

/** I lavori della CI, con i loro passi, letti dall'indentazione come fa GitHub. */
function leggiLavori(workflow: string): Lavoro[] {
  const righe = workflow.split('\n');
  const inizio = righe.findIndex((r) => /^jobs:\s*$/.test(r));
  const lavori: Lavoro[] = [];
  let corrente: { id: string; righe: string[] } | null = null;
  for (let i = inizio + 1; i < righe.length; i++) {
    const capo = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(righe[i]);
    if (capo) {
      if (corrente) lavori.push(componiLavoro(corrente.id, corrente.righe));
      corrente = { id: capo[1], righe: [] };
      continue;
    }
    if (corrente) corrente.righe.push(righe[i]);
  }
  if (corrente) lavori.push(componiLavoro(corrente.id, corrente.righe));
  return lavori;
}

/** Vero se il passo apre davvero un browser sulle pagine controllate da axe. */
function faGirareAxe(passo: Passo): boolean {
  if (!/npm run test:e2e|playwright test/.test(passo.testo)) return false;
  if (passo.testo.includes(SPEC_ACCESSIBILITA)) return true;
  // Nessun file indicato: gira tutta la cartella, quindi anche l'accessibilita'.
  return !/tests\/e2e\/[^\s'"]+\.spec\.ts/.test(passo.testo);
}

/** Tutti i modi in cui quel lavoro puo' finire verde senza aver provato niente. */
function condizioniCheLoSpengono(lavoro: Lavoro): string[] {
  const motivi: string[] = [];
  const seLavoro = /^ {4}if:\s*(.+)$/m.exec(lavoro.testo);
  if (seLavoro) motivi.push(`il lavoro intero gira solo se ${seLavoro[1].trim()}`);
  if (/^ {4}continue-on-error:\s*true/m.test(lavoro.testo)) {
    motivi.push("il lavoro e' dichiarato continue-on-error: true, quindi un rosso non ferma niente");
  }
  for (const passo of lavoro.passi) {
    const sePasso = /^ {8}if:\s*(.+)$/m.exec(passo.testo);
    if (sePasso) motivi.push(`il passo «${passo.nome}» gira solo se ${sePasso[1].trim()}`);
    if (/^ {8}continue-on-error:\s*true/m.test(passo.testo)) {
      motivi.push(`il passo «${passo.nome}» e' continue-on-error: true`);
    }
  }
  return motivi;
}

/**
 * Vuoto = il cancello e' acceso. Altrimenti l'elenco dice, in italiano, perche'
 * la CI puo' diventare verde senza che axe abbia guardato una sola pagina.
 */
function perche_axe_puo_non_girare(workflow: string): string[] {
  const candidati = leggiLavori(workflow).filter((l) => l.passi.some(faGirareAxe));
  if (candidati.length === 0) {
    return ['nessun lavoro della CI apre un browser sulle pagine controllate da axe'];
  }
  const incondizionati = candidati.filter((l) => condizioniCheLoSpengono(l).length === 0);
  if (incondizionati.length > 0) return [];
  return candidati.flatMap((l) => condizioniCheLoSpengono(l).map((m) => `${l.id}: ${m}`));
}

const ciDiOggi = readFileSync(join(process.cwd(), '.github/workflows/ci.yml'), 'utf8');

// La forma vera della CI il 30/8/2026, ridotta all'osso: il passo che decide e
// il passo che gira. E' il difetto imbottigliato, e serve a provare che il
// controllo qui sopra sa ancora riconoscerlo.
const CI_DEL_30_AGOSTO = `jobs:
  e2e-tests:
    name: E2E smoke (Playwright)
    runs-on: ubuntu-latest
    steps:
      - name: Check E2E secrets
        id: e2e
        env:
          URL: \${{ secrets.SUPABASE_TEST_URL }}
        run: |
          if [ -z "$URL" ]; then
            echo "::warning::E2E smoke SALTATI"
            echo "enabled=false" >> "$GITHUB_OUTPUT"
            exit 0
          fi
          echo "enabled=true" >> "$GITHUB_OUTPUT"

      - name: Start app + run e2e
        if: steps.e2e.outputs.enabled == 'true'
        run: npm run test:e2e -- --project=chromium
`;

describe('il cancello dell\'accessibilita nella CI', () => {
  it('sa riconoscere il giro del 30/8/2026, in cui axe non ha mai aperto un browser', () => {
    const motivi = perche_axe_puo_non_girare(CI_DEL_30_AGOSTO);
    expect(
      motivi.join(' · '),
      'il controllo non vede piu il difetto da cui nasce: cosi non protegge nessuno',
    ).toContain("steps.e2e.outputs.enabled == 'true'");
  });

  it('nella CI di oggi axe gira sempre, senza dipendere da nessuna condizione', () => {
    const motivi = perche_axe_puo_non_girare(ciDiOggi);
    expect(
      motivi,
      `La CI puo diventare verde senza aver provato l'accessibilita:\n  - ${motivi.join('\n  - ')}`,
    ).toEqual([]);
  });

  it('il lavoro che fa girare axe non chiede nessun segreto, quindi nessuno puo spegnerlo dimenticandone uno', () => {
    // Il lavoro che conta e' quello incondizionato: e' l'unico che fa girare
    // axe anche quando in cassaforte non c'e' nessun segreto.
    const lavoro = leggiLavori(ciDiOggi).find(
      (l) => l.passi.some(faGirareAxe) && condizioniCheLoSpengono(l).length === 0,
    );
    expect(lavoro, 'nessun lavoro della CI fa girare axe senza condizioni').toBeDefined();
    expect(
      lavoro!.testo.includes('secrets.'),
      `il lavoro «${lavoro!.id}» legge dei segreti: il giorno che ne manca uno torna a passare in silenzio`,
    ).toBe(false);
  });

  it('il file di prova che la CI nomina esiste davvero', () => {
    expect(
      existsSync(join(process.cwd(), SPEC_ACCESSIBILITA)),
      `la CI fa girare ${SPEC_ACCESSIBILITA}, che non c'e piu: il cancello sarebbe puntato nel vuoto`,
    ).toBe(true);
  });
});
