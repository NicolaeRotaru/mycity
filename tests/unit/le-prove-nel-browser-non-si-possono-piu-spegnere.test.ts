/**
 * 3/9/2026 — LE PROVE NEL BROWSER SI SPEGNEVANO DA SOLE, E LA CI RESTAVA VERDE.
 *
 * Il lavoro «E2E smoke (Playwright)» comincia con un passo che guarda in
 * cassaforte e decide:
 *
 *     if [ -z "$URL" ] || [ -z "$ANON" ]; then
 *       echo "::warning::E2E smoke SALTATI: servono SUPABASE_TEST_URL e ..."
 *       echo "enabled=false" >> "$GITHUB_OUTPUT"
 *
 * e ogni passo successivo e' appeso a `steps.e2e.outputs.enabled == 'true'`.
 * Quei due segreti sono di un progetto Supabase di prova che non e' mai stato
 * creato. Effetto: da mesi ogni giro finiva SUCCESS con «Build» e «Start app +
 * run e2e» SKIPPED. La spunta verde diceva «provato» e nessun browser aveva
 * aperto una pagina.
 *
 * Nel frattempo la suite invecchiava senza che nessuno lo sapesse: accesa a
 * mano il 3/9/2026 contro una build di produzione, 20 prove su 68 erano rosse.
 * E nessuna, in undici file, attraversava la cassa.
 *
 * QUESTE PROVE leggono il lavoro della CI come lo legge GitHub — lavori, passi
 * e condizioni — e chiedono tre cose:
 *   ① esiste un lavoro che apre un browser sulle pagine del sito e NIENTE, la'
 *     dentro, e' appeso a una condizione;
 *   ② quel lavoro non legge nessun segreto, cosi' nessuno puo' spegnerlo
 *     dimenticandone uno;
 *   ③ quel lavoro non si accontenta di girare: conta le prove che hanno
 *     davvero guardato e diventa rosso se sono zero, e pretende che ogni prova
 *     saltata dica perche'.
 *
 * La prima prova gira sulla forma vera del 30/8/2026 e pretende che il
 * controllo la bocci: un controllo che non sa riconoscere il difetto da cui
 * nasce non protegge nessuno.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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

/**
 * Vero se il passo apre davvero un browser sulle pagine del sito.
 *
 * Non basta che nomini Playwright: `playwright install` scarica un browser e
 * non guarda niente. Deve far girare la suite.
 */
function faGirareLeProveNelBrowser(passo: Passo): boolean {
  return /npm run test:e2e|npx playwright test/.test(passo.testo);
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

const SPEC_DELLA_CASSA = 'tests/e2e/12-la-cassa-dal-carrello-al-pagamento.spec.ts';

/**
 * Vero se il passo fa girare TUTTA la suite — o almeno il percorso della cassa.
 *
 * La distinzione conta: nella CI c'e' gia' un lavoro che apre un browser senza
 * condizioni, ma solo sulle quattro pagine controllate da axe
 * (`a11y`). Se contasse anche quello, bastava spegnere di nuovo il resto e il
 * controllo sarebbe rimasto verde credendo di essere protetto — e' esattamente
 * quello che e' successo alla prima stesura di questa prova, scoperto rompendo
 * il fix apposta.
 */
function copreLaCassa(passo: Passo): boolean {
  if (!faGirareLeProveNelBrowser(passo)) return false;
  if (passo.testo.includes(SPEC_DELLA_CASSA)) return true;
  // Nessun file indicato: gira tutta la cartella, quindi anche la cassa.
  return !/tests\/e2e\/[^\s'"]+\.spec\.ts/.test(passo.testo);
}

/** I lavori che percorrono la cassa nel browser SENZA nessuna condizione che li spenga. */
function lavoriCheProvanoSempre(workflow: string): Lavoro[] {
  return leggiLavori(workflow).filter(
    (l) => l.passi.some(copreLaCassa) && condizioniCheLoSpengono(l).length === 0,
  );
}

/**
 * Vuoto = il cancello e' acceso. Altrimenti l'elenco dice, in italiano, perche'
 * la CI puo' diventare verde senza che un browser abbia percorso la cassa.
 */
function perche_il_browser_puo_non_aprirsi(workflow: string): string[] {
  const candidati = leggiLavori(workflow).filter((l) => l.passi.some(copreLaCassa));
  if (candidati.length === 0) {
    return ['nessun lavoro della CI apre un browser sul percorso d\'acquisto'];
  }
  if (lavoriCheProvanoSempre(workflow).length > 0) return [];
  return candidati.flatMap((l) => condizioniCheLoSpengono(l).map((m) => `${l.id}: ${m}`));
}

const ciDiOggi = readFileSync(join(process.cwd(), '.github/workflows/ci.yml'), 'utf8');

/*
 * La forma vera della CI il 30/8/2026, ridotta all'osso: il passo che guarda in
 * cassaforte e il passo che gira. E' il difetto imbottigliato, e serve a
 * provare che il controllo qui sopra sa ancora riconoscerlo.
 */
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

describe('le prove nel browser non si possono piu spegnere', () => {
  it('sa riconoscere il giro del 30/8/2026, in cui nessun browser ha aperto una pagina', () => {
    const motivi = perche_il_browser_puo_non_aprirsi(CI_DEL_30_AGOSTO);
    expect(
      motivi.join(' · '),
      'il controllo non vede piu il difetto da cui nasce: cosi non protegge nessuno',
    ).toContain("steps.e2e.outputs.enabled == 'true'");
  });

  it('nella CI di oggi il browser si apre sempre, senza dipendere da nessuna condizione', () => {
    const motivi = perche_il_browser_puo_non_aprirsi(ciDiOggi);
    expect(
      motivi,
      `La CI puo diventare verde senza che nessuno abbia aperto il sito in un browser:\n  - ${motivi.join('\n  - ')}`,
    ).toEqual([]);
  });

  it('il lavoro che apre il browser non chiede nessun segreto', () => {
    const [lavoro] = lavoriCheProvanoSempre(ciDiOggi);
    expect(lavoro, 'nessun lavoro della CI apre il browser senza condizioni').toBeDefined();
    expect(
      lavoro.testo.includes('secrets.'),
      `il lavoro «${lavoro.id}» legge dei segreti: il giorno che ne manca uno torna a passare in silenzio`,
    ).toBe(false);
  });

  it('una suite che si salta tutta diventa rossa, invece di uscire con la stessa spunta di una che ha provato', () => {
    const [lavoro] = lavoriCheProvanoSempre(ciDiOggi);
    expect(lavoro).toBeDefined();
    // Il conto delle prove che hanno davvero guardato, e la porta che si chiude
    // quando sono zero. Senza questo, bastava mettere `test.skip` in cima a
    // ogni file per riavere il verde di prima.
    expect(
      /hannoGuardato\s*===\s*0/.test(lavoro.testo) && /process\.exit\(1\)/.test(lavoro.testo),
      `il lavoro «${lavoro.id}» non conta piu le prove che hanno guardato: una suite saltata per intero tornerebbe verde`,
    ).toBe(true);
    // E una prova saltata senza motivo scritto e' un interruttore travestito.
    expect(
      /saltate\.filter\(\(p\) => !p\.motivo\)/.test(lavoro.testo),
      `il lavoro «${lavoro.id}» accetta prove saltate senza dire perche'`,
    ).toBe(true);
  });

  it('la prova che attraversa la cassa esiste davvero', () => {
    // Il secondo difetto di questa coppia: in undici file di prove nel browser
    // nessuna metteva qualcosa nel carrello e arrivava al pagamento. Se il file
    // sparisce, il cancello resta puntato nel vuoto.
    expect(
      existsSync(join(process.cwd(), SPEC_DELLA_CASSA)),
      `${SPEC_DELLA_CASSA} non c'e piu: nessuna prova attraversa la cassa`,
    ).toBe(true);
  });
});
