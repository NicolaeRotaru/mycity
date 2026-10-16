/**
 * 16/10/2026 (sesto giro di correzione) — LA REGOLA «MAIN» SI CONFRONTA CON
 * QUELLA DEI PASSI, E BASTA.
 *
 * Lo script provava a leggere i rami come li legge GitHub (modelli con * e **,
 * esclusioni, la creazione di rami nuovi) e a dire cosa succedeva sugli altri
 * rami. In due giri quella lettura ha fatto nascere otto frasi sbagliate. Le
 * quattro dell'ultimo riesame, ricreate qui con la regola esatta del revisore:
 *
 *   ① regola su altri rami SENZA nessun controllo obbligatorio: diceva
 *     «nessuno puo' piu' spingere», ma senza controllo le spinte passano;
 *   ② «All branches» con «Restrict creations»: diceva che i rami nuovi si
 *     possono ancora creare, ma non si puo';
 *   ③ un modello in piu' tolto da un'esclusione piu' larga: diceva di non
 *     sapere se la regola ferma le richieste rosse, che era la parte certa;
 *   ④ l'esclusione «refs/heads/**\/*»: mandava a togliere parentesi che non
 *     c'erano.
 *
 * Adesso c'e' una regola sola: ✅ solo per la regola dei passi in testa a
 * deploy-dopo-ci.yml (accesa, solo «Include default branch», nessun ramo
 * escluso, solo il controllo «Main», nessuna voce in piu'); ❌ solo per un
 * pezzo che manca di sicuro; ⚪ con uscita 3 e «questa regola e' diversa da
 * quella della procedura: guardala a mano» per tutto il resto.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { valutaLaRegolaMain, righeDelVerdetto, uscitaDelVerdetto } from '@/scripts/controlla-regola-main.mjs';

const DIVERSA = 'questa regola e\' diversa da quella della procedura: guardala a mano';

/** Il controllo «Main» come lo pretende la regola: da GitHub Actions. */
function controlloMain(parametri: Record<string, unknown> = {}) {
  return {
    type: 'required_status_checks',
    parameters: {
      strict_required_status_checks_policy: false,
      do_not_enforce_on_create: false,
      required_status_checks: [{ context: 'Main', integration_id: 15368 }],
      ...parametri,
    },
  };
}

/** La regola dei passi: quella che deve dare ✅. Si cambia un pezzo alla volta. */
function deiPassi(cambia: Record<string, unknown> = {}) {
  return {
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] as string[] } },
    rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }, controlloMain()] as Record<string, unknown>[],
    bypass_actors: [],
    ...cambia,
  };
}

function rami(include: string[], exclude: string[] = []) {
  return { conditions: { ref_name: { include, exclude } } };
}

function verdetto(regola: unknown) {
  const esito = valutaLaRegolaMain(regola);
  const righe = righeDelVerdetto(esito);
  return { esito, righe, titolo: righe[0], testo: righe.join('\n'), uscita: uscitaDelVerdetto(esito) };
}

const cartelle: string[] = [];
afterAll(() => {
  for (const c of cartelle) rmSync(c, { recursive: true, force: true });
});

/** Lo script vero, col comando delle istruzioni e la risposta di `gh` in ritardo. */
function scriptInPipe(regola: unknown) {
  const cartella = mkdtempSync(join(tmpdir(), 'regola-passi-'));
  cartelle.push(cartella);
  const file = join(cartella, 'regola.json');
  writeFileSync(file, JSON.stringify(regola));
  const esito = spawnSync('bash', ['-c', '(sleep 1; cat "$FILE") | "$NODO" scripts/controlla-regola-main.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 30_000,
    env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', NODO: process.execPath, FILE: file },
  });
  return { uscita: esito.status ?? -1, testo: `${esito.stdout}\n${esito.stderr}` };
}

describe('i quattro casi del riesame, con la regola esatta del revisore', () => {
  it('① altri rami senza controllo obbligatorio: ❌ per «Main» che manca, e nessuna frase sulle spinte', () => {
    for (const include of [['~ALL'], ['~DEFAULT_BRANCH', 'refs/heads/claude/*']]) {
      const { esito, testo, uscita } = verdetto(deiPassi({ ...rami(include), rules: [{ type: 'deletion' }] }));
      expect(uscita, include.join(',')).toBe(1);
      expect(esito.mancano.map((m) => m.cosa), include.join(',')).toEqual(['non pretende il controllo «Main»']);
      expect(esito.diverse, include.join(',')).toHaveLength(1);
      expect(esito.diverse[0].cosa, include.join(',')).toMatch(/^i rami inclusi sono /);
      expect(testo, include.join(',')).not.toMatch(/spinge|spingere|spinte/);
    }
  });

  it('② «All branches» con «Restrict creations»: ⚪, nomina la voce in piu\' e non dice che i rami nuovi si creano', () => {
    const regola = deiPassi({
      ...rami(['~ALL']),
      rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }, { type: 'creation' }, controlloMain({ do_not_enforce_on_create: true })],
    });
    const { esito, titolo, testo, uscita } = verdetto(regola);
    expect(uscita).toBe(3);
    expect(esito.mancano).toEqual([]);
    expect(titolo).toContain(DIVERSA);
    expect(esito.diverse.map((d) => d.cosa)).toEqual([
      'i rami inclusi sono «Include all branches», e la procedura chiede solo «Include default branch»',
      'ha anche «creation», che la procedura non chiede',
    ]);
    expect(testo).not.toContain('creare');
  });

  it('③ un modello in piu\' tolto da un\'esclusione piu\' larga: ⚪ senza mettere in dubbio le richieste rosse', () => {
    const { esito, titolo, uscita } = verdetto(deiPassi(rami(['~DEFAULT_BRANCH', 'refs/heads/claude/*'], ['refs/heads/claude/**'])));
    expect(uscita).toBe(3);
    expect(esito.mancano).toEqual([]);
    expect(titolo).toBe(`⚪ Ho letto la regola «Main», ma ${DIVERSA}. Ecco in cosa:`);
    expect(esito.diverse.map((d) => d.come)).toEqual([
      'Target branches → lascia solo «Include default branch» (cioe\' main) e togli gli altri.',
      'Target branches → togli i rami esclusi («Exclude by pattern»).',
    ]);
  });

  it('④ l\'esclusione «refs/heads/**/*»: ⚪, e il consiglio e\' togliere l\'esclusione, non cercare parentesi', () => {
    const { esito, testo, uscita } = verdetto(deiPassi(rami(['~DEFAULT_BRANCH'], ['refs/heads/**/*'])));
    expect(uscita).toBe(3);
    expect(esito.diverse).toEqual([
      {
        cosa: 'esclude dei rami («refs/heads/**/*»), e la procedura non ne esclude nessuno',
        come: 'Target branches → togli i rami esclusi («Exclude by pattern»).',
      },
    ]);
    expect(testo).not.toContain('[ ]');
  });
});

describe('una regola sola: verde solo la regola dei passi', () => {
  it('la regola dei passi e\' l\'unico ✅, con uscita 0', () => {
    const { esito, titolo, uscita } = verdetto(deiPassi());
    expect(esito.protegge).toBe(true);
    expect(uscita).toBe(0);
    expect(titolo).toMatch(/^✅ /);
    // Senza le voci che la regola ha dal 26/5 resta la regola dei passi: non servono a fermare le richieste.
    expect(verdetto(deiPassi({ rules: [controlloMain()] })).uscita).toBe(0);
    // «Main» chiesto a «Any source» (senza app) vale come da GitHub Actions.
    expect(verdetto(deiPassi({ rules: [controlloMain({ required_status_checks: [{ context: 'Main' }] })] })).uscita).toBe(0);
  });

  // Ogni pezzo diverso dai passi, uno alla volta, senza niente che manchi di
  // sicuro: mai ✅, mai ❌, sempre ⚪ con uscita 3 e la frase.
  const diverse: [string, Record<string, unknown>][] = [
    ['main per nome', rami(['refs/heads/main'])],
    ['tutti i rami', rami(['~ALL'])],
    ['tutti i rami per modello', rami(['refs/heads/**'])],
    ['un modello che prende main', rami(['refs/heads/*'])],
    ['un modello in piu\'', rami(['~DEFAULT_BRANCH', 'refs/heads/claude/**'])],
    ['un altro ramo al posto di main', rami(['refs/heads/sviluppo'])],
    ['un modello con le parentesi', rami(['refs/heads/[m]ain'])],
    ['un\'esclusione che toglie main', rami(['~DEFAULT_BRANCH'], ['refs/heads/*'])],
    ['un\'esclusione che non toglie main', rami(['~DEFAULT_BRANCH'], ['refs/heads/claude/**'])],
    ['un\'esclusione di tutto', rami(['~DEFAULT_BRANCH'], ['~ALL'])],
    ['la coda di unione', { rules: [controlloMain(), { type: 'merge_queue' }] }],
    ['le revisioni obbligatorie', { rules: [controlloMain(), { type: 'pull_request' }] }],
    ['un altro controllo obbligatorio', { rules: [controlloMain({ required_status_checks: [{ context: 'Main' }, { context: 'Unit tests' }] })] }],
  ];

  it.each(diverse)('%s: ⚪, uscita 3, «guardala a mano»', (_nome, cambia) => {
    const { esito, titolo, testo, uscita } = verdetto(deiPassi(cambia));
    expect(esito.protegge).toBe(false);
    expect(esito.mancano).toEqual([]);
    expect(esito.diverse).toHaveLength(1);
    expect(uscita).toBe(3);
    expect(titolo).toBe(`⚪ Ho letto la regola «Main», ma ${DIVERSA}. Ecco in cosa:`);
    expect(testo).not.toMatch(/✅|❌/);
    expect(esito.avvisi).toEqual([]);
  });

  // Quello che manca di sicuro: ❌ con uscita 1, anche con tutto il resto in regola.
  const mancanti: [string, Record<string, unknown>, string][] = [
    ['spenta', { enforcement: 'disabled' }, 'e\' spenta'],
    ['in prova', { enforcement: 'evaluate' }, 'e\' in prova («Evaluate»)'],
    ['senza rami', rami([]), 'non guarda nessun ramo'],
    ['sulle etichette', { target: 'tag' }, 'non e\' una regola sui rami'],
    ['senza «Main»', { rules: [{ type: 'deletion' }] }, 'non pretende il controllo «Main»'],
    ['«Main» da un\'altra app', { rules: [controlloMain({ required_status_checks: [{ context: 'Main', integration_id: 999 }] })] }, 'da un\'app che non e\' GitHub Actions'],
  ];

  it.each(mancanti)('%s: ❌, uscita 1', (_nome, cambia, cosa) => {
    const { esito, titolo, uscita } = verdetto(deiPassi(cambia));
    expect(uscita).toBe(1);
    expect(esito.mancano).toHaveLength(1);
    expect(esito.mancano[0].cosa).toContain(cosa);
    expect(esito.diverse).toEqual([]);
    expect(titolo).toBe('❌ La regola «Main» non e\' quella della procedura. C\'e\' una cosa da sistemare:');
  });

  it('un pezzo che manca e uno diverso: ❌ con uscita 1, e la parte diversa si guarda a mano', () => {
    const { esito, testo, uscita } = verdetto(deiPassi({ enforcement: 'disabled', ...rami(['~DEFAULT_BRANCH'], ['refs/heads/[m]ain']) }));
    expect(uscita).toBe(1);
    expect(esito.mancano).toHaveLength(1);
    expect(esito.diverse).toHaveLength(1);
    expect(testo).toContain(`⚪ In piu', ${DIVERSA}. Ecco in cosa:`);
  });
});

describe('lo script vero, col comando delle istruzioni', { timeout: 60_000 }, () => {
  it('sulla regola del caso ③ esce 3 e scrive «guardala a mano»; sulla regola dei passi esce 0', () => {
    const diversa = scriptInPipe(deiPassi(rami(['~DEFAULT_BRANCH', 'refs/heads/claude/*'], ['refs/heads/claude/**'])));
    expect(diversa.uscita, diversa.testo).toBe(3);
    expect(diversa.testo).toContain(DIVERSA);
    expect(diversa.testo).not.toContain('✅');

    const giusta = scriptInPipe(deiPassi());
    expect(giusta.uscita, giusta.testo).toBe(0);
    expect(giusta.testo).toContain('✅');
  });
});
