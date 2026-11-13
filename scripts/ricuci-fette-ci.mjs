#!/usr/bin/env node
/**
 * ricuci-fette-ci — rimette insieme le fette della CI e pretende che ogni prova
 * abbia girato UNA volta sola.
 *
 * PERCHE' ESISTE (13/11/2026). Le prove unitarie (circa 1.400 file) e quelle nel
 * browser (76) giravano in un lavoro solo ciascuna: la CI di una richiesta
 * durava fra 5 minuti e mezzo e 7 e mezzo. Per stare sotto i tre minuti adesso
 * girano divise in fette, su macchine diverse nello stesso momento. Le prove
 * sono le stesse; cambia solo dove girano.
 *
 * Dividere apre un modo nuovo di sbagliare: una fetta che non parte, o che
 * prende la parte sbagliata, e un pezzo di prove non gira — mentre ogni fetta,
 * da sola, esce verde. Con un lavoro unico non poteva succedere. Questo script
 * chiude quel buco: legge il referto di ogni fetta e si ferma ROSSO se
 *   - manca una fetta, ce n'e' una di troppo, o due dicono di essere la stessa;
 *   - le fette non hanno girato sullo stesso commit;
 *   - le fette non vedevano lo stesso elenco di prove;
 *   - una prova dell'elenco non ha un esito, o ne ha due;
 *   - compare l'esito di una prova che nell'elenco non c'e';
 *   - una prova e' rossa (la fetta lo dice gia': qui si ricontrolla);
 *   - (browser) nessuna prova ha guardato davvero, o una e' saltata senza motivo.
 *
 * Uso:
 *   node scripts/ricuci-fette-ci.mjs vitest     <cartella-dei-referti>
 *   node scripts/ricuci-fette-ci.mjs playwright <cartella-dei-referti>
 *
 * Nella cartella c'e' una sottocartella per fetta (come la scarica
 * actions/download-artifact con `pattern:`), e dentro tre file:
 *   fetta.json     {"indice": 0, "totale": 6, "commit": "<sha>", "radice": "<cartella del repo>"}
 *   universo.json  l'elenco di TUTTE le prove (vitest list --json / playwright test --list)
 *   esito.json     il referto JSON della fetta (reporter json di vitest o di playwright)
 *
 * Uscita: 0 = ogni prova ha girato una volta sola ed e' verde; 1 = no, o non si
 * e' potuto controllare. Non esiste un «non lo so» che passa.
 */
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Lettura

function leggiJson(percorso) {
  try {
    return { valore: JSON.parse(readFileSync(percorso, 'utf8')) };
  } catch (e) {
    return { errore: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Legge le sottocartelle dei referti. Ogni problema di lettura diventa una riga
 * in `problemi`: un referto che non si legge non e' un referto verde.
 */
export function leggiFette(cartella) {
  const problemi = [];
  const fette = [];
  if (!existsSync(cartella) || !statSync(cartella).isDirectory()) {
    return { fette, problemi: [`la cartella dei referti «${cartella}» non esiste: nessuna fetta ha consegnato niente`] };
  }
  const nomi = readdirSync(cartella)
    .filter((n) => statSync(join(cartella, n)).isDirectory())
    .sort();
  if (nomi.length === 0) {
    problemi.push(`nella cartella «${cartella}» non c'e' nessun referto di fetta`);
  }
  for (const nome of nomi) {
    const pezzi = {};
    let rotta = false;
    for (const file of ['fetta', 'universo', 'esito']) {
      const percorso = join(cartella, nome, `${file}.json`);
      if (!existsSync(percorso)) {
        problemi.push(`il referto «${nome}» non ha ${file}.json`);
        rotta = true;
        continue;
      }
      const letto = leggiJson(percorso);
      if ('errore' in letto) {
        problemi.push(`il referto «${nome}»: ${file}.json non si legge (${letto.errore})`);
        rotta = true;
        continue;
      }
      pezzi[file] = letto.valore;
    }
    if (!rotta) fette.push({ nome, ...pezzi });
  }
  return { fette, problemi };
}

// ---------------------------------------------------------------------------
// Controlli comuni: quante fette, quali, su che commit

export function controllaLeFette(fette) {
  const problemi = [];
  if (fette.length === 0) return ['nessuna fetta leggibile: non si puo\' dire che le prove abbiano girato'];

  for (const f of fette) {
    const { indice, totale, commit, radice } = f.fetta ?? {};
    if (!Number.isInteger(indice) || !Number.isInteger(totale) || totale < 1 || indice < 0 || indice >= totale) {
      problemi.push(`il referto «${f.nome}» non dice bene quale fetta e' (indice ${indice}, totale ${totale})`);
    }
    if (typeof commit !== 'string' || commit.length === 0) {
      problemi.push(`il referto «${f.nome}» non dice su quale commit ha girato`);
    }
    if (typeof radice !== 'string' || radice.length === 0) {
      problemi.push(`il referto «${f.nome}» non dice in quale cartella ha girato`);
    }
  }
  if (problemi.length > 0) return problemi;

  const totali = new Set(fette.map((f) => f.fetta.totale));
  if (totali.size > 1) {
    problemi.push(`le fette non sono d'accordo su quante sono: ${[...totali].join(', ')}`);
    return problemi;
  }
  const [totale] = totali;
  const visti = new Map();
  for (const f of fette) {
    const gia = visti.get(f.fetta.indice);
    if (gia) problemi.push(`due referti dicono di essere la fetta ${f.fetta.indice + 1}: «${gia}» e «${f.nome}»`);
    else visti.set(f.fetta.indice, f.nome);
  }
  for (let i = 0; i < totale; i++) {
    if (!visti.has(i)) problemi.push(`manca il referto della fetta ${i + 1} di ${totale}: le sue prove non hanno un esito`);
  }
  const commit = new Set(fette.map((f) => f.fetta.commit));
  if (commit.size > 1) problemi.push(`le fette hanno girato su commit diversi: ${[...commit].join(', ')}`);
  return problemi;
}

// ---------------------------------------------------------------------------
// Il conto generico: ogni voce dell'universo, un esito solo

function contaUnaVolta(fette, universoDi, esitiDi) {
  const problemi = [];
  const universi = fette.map((f) => ({ nome: f.nome, voci: universoDi(f) }));
  for (const u of universi) {
    if (!Array.isArray(u.voci)) problemi.push(`il referto «${u.nome}»: l'elenco delle prove non si legge`);
  }
  if (problemi.length > 0) return { problemi, universo: new Set(), esiti: new Map() };

  const riferimento = new Set(universi[0].voci);
  for (const u of universi.slice(1)) {
    const questo = new Set(u.voci);
    const mancano = [...riferimento].filter((v) => !questo.has(v));
    const avanzano = [...questo].filter((v) => !riferimento.has(v));
    if (mancano.length > 0 || avanzano.length > 0) {
      problemi.push(
        `le fette «${universi[0].nome}» e «${u.nome}» non vedevano le stesse prove` +
          ` (${mancano.length} in meno, ${avanzano.length} in piu'; per esempio ${[...mancano, ...avanzano].slice(0, 3).join(', ')})`,
      );
    }
  }
  if (riferimento.size === 0) problemi.push('l\'elenco delle prove e\' vuoto: non c\'era niente da far girare');

  const esiti = new Map();
  for (const f of fette) {
    const lista = esitiDi(f);
    if (!Array.isArray(lista)) {
      problemi.push(`il referto «${f.nome}»: l'esito non si legge`);
      continue;
    }
    for (const e of lista) {
      const prima = esiti.get(e.chiave);
      if (prima) {
        problemi.push(`«${e.chiave}» ha girato due volte: nella fetta «${prima.fetta}» e in «${f.nome}»`);
        continue;
      }
      esiti.set(e.chiave, { ...e, fetta: f.nome });
    }
  }
  const senzaEsito = [...riferimento].filter((v) => !esiti.has(v));
  if (senzaEsito.length > 0) {
    problemi.push(
      `${senzaEsito.length} prove dell'elenco non hanno girato in nessuna fetta` +
        ` (per esempio ${senzaEsito.slice(0, 5).join(', ')})`,
    );
  }
  const fuori = [...esiti.keys()].filter((k) => !riferimento.has(k));
  if (fuori.length > 0) {
    problemi.push(`${fuori.length} esiti di prove che nell'elenco non ci sono (per esempio ${fuori.slice(0, 5).join(', ')})`);
  }
  return { problemi, universo: riferimento, esiti };
}

// ---------------------------------------------------------------------------
// Vitest: l'unita' e' il file di prova

function relativo(radice, file) {
  return relative(radice, String(file)).split('\\').join('/');
}

export function ricuciVitest(fette) {
  const problemi = controllaLeFette(fette);
  if (problemi.length > 0) return { problemi, righe: [] };

  const conto = contaUnaVolta(
    fette,
    (f) => (Array.isArray(f.universo) ? f.universo.map((v) => relativo(f.fetta.radice, v?.file)) : null),
    (f) =>
      Array.isArray(f.esito?.testResults)
        ? f.esito.testResults.map((r) => ({
            chiave: relativo(f.fetta.radice, r.name),
            stato: r.status,
            prove: Array.isArray(r.assertionResults) ? r.assertionResults : [],
          }))
        : null,
  );
  problemi.push(...conto.problemi);

  let prove = 0;
  let rosse = 0;
  let saltate = 0;
  for (const e of conto.esiti.values()) {
    if (e.stato !== 'passed' && e.stato !== 'skipped') {
      problemi.push(`il file «${e.chiave}» non e' verde (${e.stato}) nella fetta «${e.fetta}»`);
    }
    for (const p of e.prove) {
      prove += 1;
      if (p.status === 'failed') rosse += 1;
      if (p.status === 'skipped' || p.status === 'pending' || p.status === 'todo') saltate += 1;
    }
  }
  for (const f of fette) {
    if (f.esito && f.esito.success === false) problemi.push(`la fetta «${f.nome}» dice di non essere verde`);
    if (f.esito && Number(f.esito.numFailedTests) > 0) {
      problemi.push(`la fetta «${f.nome}» ha ${f.esito.numFailedTests} prove rosse`);
    }
  }
  if (rosse > 0) problemi.push(`${rosse} prove rosse in tutto`);
  if (conto.esiti.size > 0 && prove === 0) problemi.push('nessuna prova ha girato davvero dentro i file');

  const righe = [
    '### Prove unitarie, tutte le fette insieme',
    '',
    `- **${conto.esiti.size} file** su ${conto.universo.size} dell'elenco, ognuno in una fetta sola (${fette.length} fette)`,
    `- **${prove} prove**: ${prove - rosse - saltate} passate, ${rosse} rosse, ${saltate} saltate`,
  ];
  return { problemi, righe };
}

// ---------------------------------------------------------------------------
// Playwright: l'unita' e' la singola prova, per progetto (chromium)

function tutteLeProvePlaywright(gruppi = [], titoli = []) {
  return gruppi.flatMap((g) => {
    const qui = g.title ? [...titoli, g.title] : titoli;
    return [
      ...(g.specs ?? []).flatMap((s) =>
        (s.tests ?? []).map((t) => ({
          chiave: `${s.file ?? g.file ?? '?'}:${s.line ?? '?'}:${s.column ?? '?'} › ${[...qui, s.title].join(' › ')} [${t.projectName ?? t.projectId ?? '?'}]`,
          nome: `${String(s.file ?? g.file ?? '').replace('tests/e2e/', '')} › ${s.title}`,
          stato: t.status,
          motivo:
            (t.annotations ?? []).find((a) => a.type === 'skip')?.description ??
            (t.results ?? []).flatMap((r) => r.annotations ?? []).find((a) => a.type === 'skip')?.description ??
            '',
        })),
      ),
      ...tutteLeProvePlaywright(g.suites ?? [], qui),
    ];
  });
}

export function ricuciPlaywright(fette) {
  const problemi = controllaLeFette(fette);
  if (problemi.length > 0) return { problemi, righe: [] };

  const conto = contaUnaVolta(
    fette,
    (f) => (Array.isArray(f.universo?.suites) ? tutteLeProvePlaywright(f.universo.suites).map((p) => p.chiave) : null),
    (f) => (Array.isArray(f.esito?.suites) ? tutteLeProvePlaywright(f.esito.suites) : null),
  );
  problemi.push(...conto.problemi);

  const prove = [...conto.esiti.values()];
  const saltate = prove.filter((p) => p.stato === 'skipped');
  const rosse = prove.filter((p) => p.stato === 'unexpected' || p.stato === 'timedOut');
  const ballerine = prove.filter((p) => p.stato === 'flaky');
  const passate = prove.filter((p) => p.stato === 'expected');
  const sconosciute = prove.filter((p) => !['skipped', 'unexpected', 'timedOut', 'flaky', 'expected'].includes(p.stato));
  const hannoGuardato = prove.length - saltate.length;

  if (rosse.length > 0) problemi.push(`${rosse.length} prove nel browser rosse: ${rosse.slice(0, 5).map((p) => p.nome).join(', ')}`);
  for (const p of sconosciute) problemi.push(`«${p.nome}» ha un esito che non conosco: ${p.stato}`);
  if (prove.length > 0 && hannoGuardato === 0) {
    problemi.push('le prove nel browser si sono saltate tutte: nessuna pagina e\' stata aperta');
  }
  for (const p of saltate.filter((s) => !s.motivo)) problemi.push(`«${p.nome}» e' saltata senza dire perche'`);

  const righe = [
    '### Prove nel browser (senza chiavi), tutte le fette insieme',
    '',
    `- **${prove.length} prove** su ${conto.universo.size} dell'elenco, ognuna in una fetta sola (${fette.length} fette)`,
    `- **${passate.length} passate**, **${rosse.length} rosse**` +
      (ballerine.length > 0 ? `, **${ballerine.length} ballerine** (verdi solo al secondo tentativo)` : ''),
    `- **${saltate.length} saltate**, e qui sotto c'e' il perche' di ognuna:`,
    '',
    ...saltate.map((p) => `  - \`${p.nome}\` — ${p.motivo || 'saltata senza motivo dichiarato'}`),
    '',
    hannoGuardato > 0
      ? `${hannoGuardato} prove hanno davvero aperto una pagina o interrogato il server. Nessun segreto e' stato usato.`
      : 'NESSUNA prova ha guardato niente.',
  ];
  return { problemi, righe };
}

// ---------------------------------------------------------------------------
// Da riga di comando

export function principale(argv, ambiente = process.env) {
  const [tipo, cartella] = argv;
  const ricuci = { vitest: ricuciVitest, playwright: ricuciPlaywright }[tipo];
  if (!ricuci || !cartella) {
    console.log('::error::uso: node scripts/ricuci-fette-ci.mjs <vitest|playwright> <cartella-dei-referti>');
    return 1;
  }
  const letto = leggiFette(cartella);
  const esito = letto.problemi.length > 0 ? { problemi: letto.problemi, righe: [] } : ricuci(letto.fette);
  const righe = [...esito.righe];
  if (esito.problemi.length > 0) {
    righe.push('', `## ⛔ Le fette non tornano (${tipo})`, '', ...esito.problemi.map((p) => `- ${p}`));
  }
  if (ambiente.GITHUB_STEP_SUMMARY) appendFileSync(ambiente.GITHUB_STEP_SUMMARY, `${righe.join('\n')}\n`);
  console.log(righe.join('\n'));
  for (const p of esito.problemi) console.log(`::error::${p}`);
  return esito.problemi.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(principale(process.argv.slice(2)));
}
