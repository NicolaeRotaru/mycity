/**
 * L'anteprima di «Migliora tutto il catalogo» e il lavoro da ritrovare.
 *
 * 1668 — L'anteprima mostrava il riassunto scritto dal modello («aggiunti
 * ingredienti e allergeni»), mentre la modifica vera viene ripulita (prezzo e
 * dichiarazioni non escono mai dal lavoro massivo). Qui si elencano i campi
 * che verranno scritti davvero; il riassunto resta solo come nota.
 *
 * 615 — Il lavoro viveva solo nella memoria della pagina: ricaricata, il lotto
 * pagato non si ritrovava più. L'identificativo si tiene nel browser e la
 * pagina riparte da lì.
 */

const ETICHETTE: Record<string, string> = {
  name: 'Nome',
  description: 'Descrizione',
  tags: 'Tag',
  category_slug: 'Categoria',
  category_id: 'Categoria',
  attributes: 'Caratteristiche',
  unit: 'Unità',
  condition: 'Condizione',
};

export type CampoDellaModifica = { chiave: string; etichetta: string; valore: string };

function leggibile(v: unknown): string {
  if (Array.isArray(v)) return v.map(String).join(', ');
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${k}: ${Array.isArray(x) ? x.join(', ') : String(x)}`)
      .join(' · ');
  }
  return String(v ?? '');
}

/** I campi che la modifica ripulita scrive davvero, con il valore nuovo. Vuoto = nessuna modifica. */
export function campiDellaModifica(patch: Record<string, unknown> | undefined | null): CampoDellaModifica[] {
  if (!patch) return [];
  return Object.entries(patch)
    .filter(([, v]) => v !== undefined && v !== null && !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0))
    .map(([chiave, v]) => ({ chiave, etichetta: ETICHETTE[chiave] ?? chiave, valore: leggibile(v).slice(0, 160) }));
}

export const CHIAVE_LAVORO_IN_CORSO = 'mycity:ai-batch:lavoro';

export function ricordaLavoro(jobId: string | null): void {
  try {
    if (jobId) window.localStorage.setItem(CHIAVE_LAVORO_IN_CORSO, jobId);
    else window.localStorage.removeItem(CHIAVE_LAVORO_IN_CORSO);
  } catch {
    /* navigazione privata: il lavoro si ritrova solo finché la pagina resta aperta */
  }
}

export function lavoroRicordato(): string | null {
  try {
    return window.localStorage.getItem(CHIAVE_LAVORO_IN_CORSO);
  } catch {
    return null;
  }
}
