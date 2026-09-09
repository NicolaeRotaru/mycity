import { supabase } from '@/lib/supabase/client';

/**
 * Il salvataggio di un prodotto, visto dal browser.
 *
 * 8/9/2026 — PERCHE' NON SI SCRIVE PIU' DIRITTO SUL CATALOGO.
 *
 * Il modulo del prodotto e l'elenco facevano
 * `supabase.from('products').update(...)` e via. Funzionava, ma di quella
 * modifica non restava traccia: il registro delle azioni (`audit_logs`) accetta
 * solo il client amministrativo — e deve restare cosi', un registro in cui puo'
 * scrivere chiunque non prova niente — quindi dal browser la traccia non era
 * proprio scrivibile.
 *
 * Adesso il salvataggio passa da `PATCH /api/seller/products/:id`, che rilegge
 * com'era, scrive, e registra la differenza. Le regole per riga del database
 * valgono uguale: la rotta usa il client di chi ha chiamato, non
 * l'amministrativo.
 *
 * Qui non c'e' nessuna regola: solo il gettone della sessione e l'indirizzo.
 */
export async function salvaProdottoDalBrowser(opts: {
  prodottoId: string;
  payload: Record<string, unknown>;
  /** Da quale schermata arriva la modifica: finisce nel registro. */
  origine: string;
  /** I campi che ha proposto l'assistente AI (vuoto = tutto scritto a mano). */
  campiDallAi?: string[];
}): Promise<string[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Sessione scaduta: rientra e riprova.');

  const res = await fetch(`/api/seller/products/${encodeURIComponent(opts.prodottoId)}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      payload: opts.payload,
      origine: opts.origine,
      campiDallAi: opts.campiDallAi ?? [],
    }),
  });

  const json = (await res.json().catch(() => null)) as
    | { ok?: boolean; data?: { campi?: string[] }; error?: { message?: string } }
    | null;
  if (!res.ok) throw new Error(json?.error?.message ?? 'Non sono riuscito a salvare. Riprova.');
  return json?.data?.campi ?? [];
}
