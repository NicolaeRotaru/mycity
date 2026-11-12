/**
 * 3/9/2026 — LA CONSOLLE DELLE EMERGENZE DICEVA «TUTTO TRANQUILLO» ANCHE QUANDO
 * NON AVEVA LETTO NIENTE.
 *
 * La pagina che sorveglia gli SOS dei fattorini leggeva così:
 *
 *     const { data } = await supabase.from('rider_sos_events')…
 *     return (data ?? []) as SOS[];
 *
 * L'errore non veniva nemmeno raccolto. Quindi «non ho letto» e «non c'è
 * niente» diventavano lo stesso identico valore: un elenco vuoto. E l'elenco
 * vuoto qui non è neutro — accende un riquadro VERDE col segno di spunta:
 * «Nessun SOS attivo. Tutto tranquillo.» Con l'aggiornamento automatico ogni
 * dieci secondi, quella rassicurazione si ripeteva da sola all'infinito mentre
 * la consolle guardava il vuoto.
 *
 * Un fattorino preme SOS di sera in una zona isolata. L'evento è scritto nel
 * database. Chi sta in sala controllo vede il verde. Nessuno chiama.
 *
 * ── La regola che questo file fa rispettare ─────────────────────────────────
 * ① Il verde nasce SOLO da una lettura riuscita. Mai dal silenzio.
 * ② Quando la lettura non riesce non si nasconde quello che si era già letto:
 *    se un SOS era in elenco, il numero di telefono e la posizione restano a
 *    schermo — spariscono proprio nel momento in cui servono, altrimenti. Sopra
 *    ci va l'avviso che quei dati potrebbero essere vecchi.
 *
 * Sta in un file suo, e non dentro la pagina, per una ragione sola: così la
 * regola si può ESEGUIRE in una prova. Dentro la pagina non si poteva.
 */

export type EventoSOS = {
  id: string;
  rider_id: string;
  order_id: string | null;
  lat: number | null;
  lng: number | null;
  triggered_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
  rider: { full_name: string | null; phone: string | null } | null;
};

export type StatoConsolle = {
  /** Vero solo se l'ultima lettura è andata a buon fine. È l'unica porta del verde. */
  letturaRiuscita: boolean;
  /** Vero quando non è mai arrivato nessun elenco: non c'è nemmeno una copia vecchia. */
  maiLetto: boolean;
  /** Vero mentre la prima lettura è ancora per strada (non è un guasto, non è un vuoto). */
  inAttesa: boolean;
  attivi: EventoSOS[];
  risolti: EventoSOS[];
};

/**
 * Cosa può dire la consolle, adesso.
 *
 * `dati` è l'elenco che ha in mano (anche quello dell'ultima lettura riuscita,
 * se l'ultima è fallita); `guasto` è la lettura che non è riuscita; `inCorso`
 * è la prima lettura ancora per strada.
 */
export function statoDellaConsolle(input: {
  dati?: EventoSOS[] | null;
  guasto: boolean;
  inCorso: boolean;
}): StatoConsolle {
  const elenco = Array.isArray(input.dati) ? input.dati : null;
  const maiLetto = elenco === null;

  return {
    // Nessuna scorciatoia: senza un elenco vero in mano non si rassicura
    // nessuno, nemmeno quando nessuno ha dichiarato un errore.
    letturaRiuscita: !input.guasto && !maiLetto,
    maiLetto,
    inAttesa: maiLetto && !input.guasto && input.inCorso,
    attivi: (elenco ?? []).filter((s) => !s.resolved_at),
    risolti: (elenco ?? []).filter((s) => s.resolved_at),
  };
}

/** Vero quando la consolle può dire «tutto tranquillo»: letto davvero, e vuoto davvero. */
export function puoDireTuttoTranquillo(stato: StatoConsolle): boolean {
  return stato.letturaRiuscita && stato.attivi.length === 0;
}

/**
 * R01-006 (12/11/2026) — DA QUALE CONSEGNA PARTE L'ALLARME.
 *
 * L'SOS scrive `order_id` quando il fattorino lo preme durante una consegna, e la pagina lo
 * leggeva nella select senza mostrarlo da nessuna parte: chi sta in sala controllo non sapeva
 * quale cliente aspetta, quale negozio chiamare, dove stava andando il fattorino.
 * `null` quando l'SOS non e' legato a nessun ordine.
 */
export function consegnaDellSOS(s: Pick<EventoSOS, 'order_id'>): { etichetta: string; href: string } | null {
  const id = typeof s.order_id === 'string' ? s.order_id.trim() : '';
  if (!id) return null;
  return { etichetta: `Consegna #${id.slice(0, 8)}`, href: `/admin/orders/${encodeURIComponent(id)}` };
}

/**
 * R01-009 (12/11/2026) — UN SOS APERTO NON ESCE DALL'ELENCO PERCHE' E' VECCHIO.
 *
 * La consolle leggeva solo gli ultimi 50 eventi. Con cinquanta SOS piu' recenti (anche gia'
 * risolti, anche falsi allarmi) un'emergenza ancora aperta restava fuori, e con zero «attivi»
 * la pagina diceva «Nessun SOS attivo. Tutto tranquillo.». Adesso si leggono anche TUTTI gli
 * aperti, a parte, e si uniscono qui: ogni evento una volta sola, dal piu' recente.
 */
export function unisciGliAperti(ultimi: EventoSOS[], aperti: EventoSOS[]): EventoSOS[] {
  const perId = new Map<string, EventoSOS>();
  for (const s of [...aperti, ...ultimi]) perId.set(s.id, s);
  return [...perId.values()].sort((a, b) => b.triggered_at.localeCompare(a.triggered_at));
}
