#!/usr/bin/env node
/**
 * SI PUBBLICAVA E NON GUARDAVA NESSUNO.
 *
 * Radiografia del 27/8/2026 (R178). Dopo `vercel deploy --prod` il lavoro di
 * rilascio finiva verde e basta. Se il sito rispondeva 500 a tutti, il verde
 * restava verde: nessuno controllava, e nessuno tornava indietro. Il primo a
 * saperlo era un cliente.
 *
 * Questo file e' la verifica minima che un rilascio ha senso: tre indirizzi,
 * qualche tentativo, e un esito che vale come sentenza.
 *
 *   · /api/health        — il processo e' vivo? (deve rispondere 2xx e NON
 *                          dichiararsi `unhealthy`)
 *   · /api/health/ready  — e' pronto a servire? (database raggiungibile)
 *   · /                  — la home si disegna davvero?
 *
 * PERCHE' I TENTATIVI. Subito dopo una pubblicazione la prima chiamata puo'
 * trovare la funzione ancora fredda. Un solo tentativo trasformerebbe una
 * partenza lenta in un finto guasto — e un finto guasto che fa tornare indietro
 * un rilascio buono e' peggio del difetto che si voleva prendere.
 *
 * PERCHE' UN MODULO E NON RIGHE DI SHELL. Cosi' e' provabile: la decisione sta
 * in `esitoDellaProva`, che non tocca la rete, e
 * tests/unit/la-prova-di-fumo-boccia-un-sito-rotto.test.ts la mette alle
 * strette sui casi che contano.
 */

/** Gli indirizzi da provare, con la regola che ognuno deve rispettare. */
export const CONTROLLI = [
  {
    percorso: '/api/health',
    nome: 'il processo e vivo',
    // `degraded` passa di proposito: vuol dire «in piedi ma con qualcosa da
    // guardare» — un database lento non e' un buon motivo per tornare indietro.
    accetta: (stato, corpo) => stato >= 200 && stato < 300 && corpo?.status !== 'unhealthy',
  },
  {
    percorso: '/api/health/ready',
    nome: 'e pronto a servire',
    accetta: (stato) => stato >= 200 && stato < 300,
  },
  {
    percorso: '/',
    nome: 'la home si disegna',
    accetta: (stato) => stato >= 200 && stato < 300,
  },
];

/**
 * La sentenza, separata dalla rete perche' sia provabile.
 * @param {Array<{nome: string, ok: boolean, dettaglio: string}>} esiti
 */
export function esitoDellaProva(esiti) {
  const falliti = esiti.filter((e) => !e.ok);
  return {
    passata: falliti.length === 0,
    falliti,
    riassunto: falliti.length === 0
      ? `prova di fumo passata: ${esiti.length} controlli su ${esiti.length}`
      : `prova di fumo FALLITA su ${falliti.length} controlli su ${esiti.length}: ` +
        falliti.map((f) => `${f.nome} (${f.dettaglio})`).join('; '),
  };
}

/** Un solo controllo, con i suoi tentativi. */
export async function provaUnControllo(base, controllo, opzioni = {}) {
  const { tentativi = 5, attesaMs = 5000, timeoutMs = 10_000, fetchImpl = fetch, dormi } = opzioni;
  const aspetta = dormi ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let dettaglio = 'mai provato';

  for (let n = 1; n <= tentativi; n++) {
    try {
      const ctrl = new AbortController();
      const scadenza = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetchImpl(`${base}${controllo.percorso}`, {
        signal: ctrl.signal,
        headers: { 'user-agent': 'mycity-prova-di-fumo' },
      });
      clearTimeout(scadenza);

      let corpo = null;
      try {
        corpo = await res.clone().json();
      } catch {
        // La home non e' JSON: e' normale, conta solo il codice di risposta.
      }

      if (controllo.accetta(res.status, corpo)) {
        return { nome: controllo.nome, ok: true, dettaglio: `HTTP ${res.status} al tentativo ${n}` };
      }
      dettaglio = `HTTP ${res.status}${corpo?.status ? ` status=${corpo.status}` : ''}`;
    } catch (e) {
      dettaglio = e?.name === 'AbortError' ? `nessuna risposta entro ${timeoutMs} ms` : String(e?.message ?? e);
    }
    if (n < tentativi) await aspetta(attesaMs);
  }
  return { nome: controllo.nome, ok: false, dettaglio };
}

/** Tutti i controlli, in fila. */
export async function provaDiFumo(base, opzioni = {}) {
  const esiti = [];
  for (const c of CONTROLLI) esiti.push(await provaUnControllo(base, c, opzioni));
  return esitoDellaProva(esiti);
}

// Avviato a mano dal lavoro di rilascio: `node scripts/prova-di-fumo.mjs <url>`
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const base = (process.argv[2] ?? '').replace(/\/+$/, '');
  if (!base) {
    console.error('Uso: node scripts/prova-di-fumo.mjs https://indirizzo-del-sito');
    process.exit(2);
  }
  const esito = await provaDiFumo(base);
  console.log(esito.riassunto);
  process.exit(esito.passata ? 0 : 1);
}
