/**
 * 15/10/2026 (R13) — IL VERBALE DELL'ACCETTAZIONE, SCRITTO DA UNA PARTE SOLA.
 *
 * Chi si registra spunta «accetto Termini e Informativa», e la versione dei
 * testi viaggia dentro i suoi dati fino al primo accesso vero, dove il server la
 * mette a verbale (`consent_log` + `profiles.tos_accepted_at`). Fino a oggi lo
 * faceva solo `/auth/callback`, cioe' solo chi apriva il link di conferma NELLO
 * STESSO browser con cui si era registrato.
 *
 * Chi lo apriva dal telefono, dopo essersi registrato dal computer, vedeva lo
 * scambio fallire, finiva sulla pagina di accesso, entrava con email e password
 * — e il verbale non si scriveva mai: nessuna riga, nessuna versione del testo.
 *
 * Adesso le porte d'ingresso sono tre (il ritorno del link, la conferma col
 * token_hash, l'accesso con email e password) e tutte usano questo modulo:
 * una copia sola, che quando si corregge si corregge ovunque.
 */

/** Il minimo del client amministrativo che serve qui: le tabelle. */
type TabellaMinima = {
  select(colonne: string): {
    eq(colonna: string, valore: string): {
      maybeSingle(): PromiseLike<{ data: { tos_accepted_at?: string | null } | null; error?: unknown }>;
    };
  };
  insert(riga: Record<string, unknown>): PromiseLike<{ error: unknown }>;
  update(campi: Record<string, unknown>): { eq(colonna: string, valore: string): PromiseLike<{ error?: unknown }> };
};

export type ClientPerVerbale = { from(tabella: string): unknown };

function tabella(admin: ClientPerVerbale, nome: string): TabellaMinima {
  return admin.from(nome) as TabellaMinima;
}

/**
 * Quale versione dei testi ha accettato questa persona.
 *
 * Prima i suoi dati (la registrazione con email ce la mette), poi l'indirizzo
 * di ritorno (il pulsante Google la mette li'). `null` = non lo sappiamo.
 */
export function versioneAccettata(
  utente: { user_metadata?: Record<string, unknown> | null } | null | undefined,
  dallIndirizzo?: string | null,
): string | null {
  const daiDati = utente?.user_metadata?.versione_testi_accettati;
  if (typeof daiDati === 'string' && daiDati.trim()) return daiDati.trim().slice(0, 60);
  if (typeof dallIndirizzo === 'string' && dallIndirizzo.trim()) return dallIndirizzo.trim().slice(0, 60);
  return null;
}

export type EsitoVerbale = 'registrata' | 'gia-accettata' | 'profilo-assente' | 'non-scritta';

/**
 * Mette a verbale l'accettazione, una volta sola.
 *
 * Il profilo si segna come «accettato» SOLO se la riga del verbale e' entrata:
 * supabase-js non lancia, restituisce `{ error }`, e un profilo segnato senza
 * la riga sarebbe una spunta senza prova.
 */
export async function verbalizzaAccettazione(
  admin: ClientPerVerbale,
  dati: { utenteId: string; versione: string; ip: string | null; userAgent: string | null },
): Promise<EsitoVerbale> {
  const { data: profilo } = await tabella(admin, 'profiles')
    .select('tos_accepted_at')
    .eq('id', dati.utenteId)
    .maybeSingle();
  if (!profilo) return 'profilo-assente';
  if (profilo.tos_accepted_at) return 'gia-accettata';

  const { error } = await tabella(admin, 'consent_log').insert({
    user_id: dati.utenteId,
    categoria: 'privacy_terms',
    valore: true,
    versione_testo: dati.versione.slice(0, 60),
    ip: dati.ip,
    user_agent: dati.userAgent?.slice(0, 300) ?? null,
  });
  if (error) return 'non-scritta';

  await tabella(admin, 'profiles')
    .update({ tos_accepted_at: new Date().toISOString() })
    .eq('id', dati.utenteId);
  return 'registrata';
}

/**
 * Questa persona non ha mai accettato i testi, e non sappiamo quale versione
 * abbia davanti: va chiesto. `false` anche quando il profilo non c'e'.
 */
export async function vaChiestaLAccettazione(admin: ClientPerVerbale, utenteId: string): Promise<boolean> {
  const { data: profilo } = await tabella(admin, 'profiles')
    .select('tos_accepted_at')
    .eq('id', utenteId)
    .maybeSingle();
  return !!profilo && !profilo.tos_accepted_at;
}
