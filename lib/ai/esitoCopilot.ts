// lib/ai/esitoCopilot.ts

/**
 * 15/10/2026 (R36) — IL MOTIVO C'ERA NELLA RISPOSTA, E IL NEGOZIANTE NON LO VEDEVA.
 *
 * Quando il Catalog Copilot mette in vendita una bozza che non ha tutto — un
 * alimento senza allergeni o senza ingredienti — la rotta la lascia ferma e
 * scrive il perche' in `results[].motivo`: «prima di metterlo in vendita va
 * completato: Allergeni, Ingredienti». Lo schermo del Copilot pero' leggeva
 * solo il conteggio, e diceva «Le altre 1 non sono passate: apri quei prodotti
 * e guarda cosa non torna». Il fornaio doveva indovinare quale prodotto e cosa
 * mancava, proprio la cosa che la rotta sapeva gia'.
 *
 * Qui il conteggio diventa una frase con i nomi dei prodotti fermi e il loro
 * motivo. I primi tre per esteso, gli altri contati: un avviso non e' un elenco.
 */

export type EsitoApplicazioneInBlocco = {
  applied?: unknown;
  results?: unknown;
};

export type AvvisoCopilot = { tipo: 'successo' | 'avviso'; testo: string };

const MOSTRATI = 3;

/**
 * 16/10/2026 (giro di correzione) — «APPLICATO A 1 PRODOTTI SU 1», E IL SESAMO
 * NON C'ERA.
 *
 * Il fornaio scrive al Copilot «aggiungi sesamo agli allergeni delle focacce e
 * mettile col tag novita'». La rotta scrive il tag; gli allergeni no, perche'
 * le dichiarazioni le scrive il negoziante (R41). Ma l'esito di quel prodotto
 * era «ok» senza motivo, e qui diventava «Applicato a 1 prodotti su 1»: lui
 * credeva di aver dichiarato il sesamo.
 *
 * Adesso una modifica scritta solo in parte porta `nonApplicato` (cosa non e'
 * entrato e perche', con la frase fissa della dettatura) e l'avviso lo dice:
 * «Applicate 1 modifiche su 1, ma 1 non per intero: «Focaccia»: …». Il verde
 * esce solo se tutto e' entrato.
 *
 * E i motivi si cuciono senza la loro punteggiatura finale: quello del
 * guardiano degli allergeni finisce gia' con un punto, e l'avviso mostrava
 * «».;» fra due prodotti e «»..» in fondo.
 */
export function avvisoDopoLApplicazione(
  risposta: EsitoApplicazioneInBlocco,
  modifiche: { product_id: string; name: string }[],
): AvvisoCopilot {
  const totale = modifiche.length;
  const applicate = typeof risposta.applied === 'number' ? risposta.applied : 0;
  const nomeDi = new Map(modifiche.map((m) => [m.product_id, m.name]));
  const esiti = (Array.isArray(risposta.results) ? risposta.results : [])
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({
      ok: r.ok,
      nome: nomeDi.get(String(r.productId)) ?? 'un prodotto',
      motivo: String(r.motivo ?? '').trim(),
      nonApplicato: String(r.nonApplicato ?? '').trim(),
    }));
  const inParte = esiti.filter((e) => e.ok === true && e.nonApplicato);
  if (applicate >= totale && inParte.length === 0) {
    return { tipo: 'successo', testo: `Applicato a ${applicate} prodotti su ${totale}.` };
  }
  const inizio = `Applicate ${applicate} modifiche su ${totale}`;
  const frasi = [
    inParte.length > 0
      ? `${inizio}, ma ${inParte.length} non per intero: ${elenco(inParte.map((e) => [e.nome, e.nonApplicato]), inParte.length)}.`
      : `${inizio}.`,
  ];
  if (applicate < totale) {
    const conMotivo = esiti.filter((e) => e.ok === false && e.motivo);
    frasi.push(
      conMotivo.length === 0
        ? `Le altre ${totale - applicate} non sono passate: apri quei prodotti e guarda cosa non torna.`
        : `Ferme: ${elenco(conMotivo.map((e) => [e.nome, e.motivo]), totale - applicate)}.`,
    );
  }
  return { tipo: 'avviso', testo: frasi.join(' ') };
}

/** I primi tre per esteso, gli altri contati; ogni motivo senza la sua punteggiatura finale. */
function elenco(righe: [nome: string, motivo: string][], quanti: number): string {
  const mostrate = righe.slice(0, MOSTRATI).map(([nome, motivo]) => `«${nome}»: ${senzaPuntoFinale(motivo)}`);
  const altri = quanti - mostrate.length;
  return `${mostrate.join('; ')}${altri > 0 ? `; e altre ${altri}` : ''}`;
}

function senzaPuntoFinale(testo: string): string {
  return testo.replace(/[\s.;:,]+$/, '');
}
