/**
 * 1/11/2026 — LA RICHIESTA DI RESO NON SPARISCE.
 *
 * Il cliente inviava il reso, tornava sulla pagina dell'ordine e li' non c'era
 * traccia della richiesta: il pulsante «Richiedi reso» restava identico, e
 * l'invito era a ricompilare tutto per sentirsi dire dal server «esiste gia'».
 * Qui si decide cosa dire al posto del pulsante, guardando i resi dell'ordine.
 *
 * Gli stati «aperti» sono gli stessi che blocca il server
 * (app/api/returns/create/route.ts): finche' uno e' aperto, un secondo reso non parte.
 */
export type RigaReso = { id: string; status: string; created_at: string | null };

const APERTI: Record<string, string> = {
  REQUESTED: 'Reso richiesto: il negozio deve ancora rispondere',
  APPROVED: 'Reso accettato dal negozio: riporta la merce',
  SHIPPED_BACK: 'Merce in viaggio verso il negozio',
  RECEIVED: 'Il negozio ha ricevuto la merce: rimborso in arrivo',
};

const CHIUSI: Record<string, string> = {
  REFUNDED: 'Reso rimborsato',
  REJECTED: 'Il negozio ha rifiutato il reso',
  CANCELED: 'Richiesta di reso annullata',
};

export type StatoDelReso = {
  /** La frase da mostrare al cliente. */
  testo: string;
  /** Vero se si puo' ancora chiedere un reso nuovo (nessuno aperto, nessuno gia' rimborsato). */
  sePuoChiederne: boolean;
  /** Vero se c'e' una richiesta aperta: la pagina porta alla richiesta, dove si puo' ritirare. */
  aperto: boolean;
};

/** Il reso piu' recente decide cosa vede il cliente; nessun reso → `null` (si mostra il pulsante). */
export function statoDelReso(resi: RigaReso[] | null | undefined): StatoDelReso | null {
  if (!resi || resi.length === 0) return null;
  const aperto = resi.find((r) => r.status in APERTI);
  if (aperto) return { testo: APERTI[aperto.status], sePuoChiederne: false, aperto: true };
  const ultimo = [...resi].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0];
  if (ultimo.status === 'REFUNDED') return { testo: CHIUSI.REFUNDED, sePuoChiederne: false, aperto: false };
  return { testo: CHIUSI[ultimo.status] ?? 'Richiesta di reso registrata', sePuoChiederne: true, aperto: false };
}
