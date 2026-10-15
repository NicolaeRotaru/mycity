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

export function avvisoDopoLApplicazione(
  risposta: EsitoApplicazioneInBlocco,
  modifiche: { product_id: string; name: string }[],
): AvvisoCopilot {
  const totale = modifiche.length;
  const applicate = typeof risposta.applied === 'number' ? risposta.applied : 0;
  if (applicate >= totale) {
    return { tipo: 'successo', testo: `Applicato a ${applicate} prodotti su ${totale}.` };
  }
  const nomeDi = new Map(modifiche.map((m) => [m.product_id, m.name]));
  const fermi = (Array.isArray(risposta.results) ? risposta.results : [])
    .filter(
      (r): r is { productId: string; ok: boolean; motivo?: string } =>
        !!r && typeof r === 'object' && (r as { ok?: unknown }).ok === false,
    )
    .map((r) => ({ nome: nomeDi.get(r.productId) ?? 'un prodotto', motivo: String(r.motivo ?? '').trim() }));
  const inizio = `Applicate ${applicate} modifiche su ${totale}.`;
  const conMotivo = fermi.filter((f) => f.motivo);
  if (conMotivo.length === 0) {
    return {
      tipo: 'avviso',
      testo: `${inizio} Le altre ${totale - applicate} non sono passate: apri quei prodotti e guarda cosa non torna.`,
    };
  }
  const righe = conMotivo.slice(0, MOSTRATI).map((f) => `«${f.nome}»: ${f.motivo}`);
  const altri = totale - applicate - righe.length;
  return {
    tipo: 'avviso',
    testo: `${inizio} Ferme: ${righe.join('; ')}${altri > 0 ? `; e altre ${altri}` : ''}.`,
  };
}
