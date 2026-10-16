/**
 * La scrittura su UNA riga come la fa PostgREST, per i finti scritti a mano
 * nelle prove di `refundOrder` (quelli che tengono l'ordine in `state.order`).
 *
 * 16/10/2026 (quinto riesame del lotto) — `refundOrder` adesso scrive la quota
 * del negozio e l'elenco dei rimborsi SOLO se sono ancora quelli letti:
 * `update(...).eq('id', …).eq('seller_payout_reversed_cents', …).select('id')`.
 * I finti a mano rispondevano già a `.eq()` con la promessa finale, e la
 * seconda condizione non la sapevano fare. Qui le condizioni si guardano
 * davvero sulla riga: se passano, `scrivi()` fa quello che il finto faceva
 * prima; se no, non si scrive niente e `select` torna vuoto, come PostgREST.
 */
type Riga = Record<string, unknown>;
type Esito = { data?: unknown; error: null };

export function scritturaSuUnaRiga(riga: () => Riga, scrivi: () => void) {
  const condizioni: Array<(r: Riga) => boolean> = [];
  let restituisce = false;
  const q = {
    eq(colonna: string, valore: unknown) {
      condizioni.push((r) => r[colonna] === valore);
      return q;
    },
    is(colonna: string, valore: unknown) {
      condizioni.push((r) => (r[colonna] ?? null) === valore);
      return q;
    },
    select(_colonne?: string) {
      restituisce = true;
      return q;
    },
    then<A = Esito, B = never>(
      ok?: ((v: Esito) => A | PromiseLike<A>) | null,
      ko?: ((e: unknown) => B | PromiseLike<B>) | null,
    ): Promise<A | B> {
      const passa = condizioni.every((c) => c(riga()));
      if (passa) scrivi();
      const esito: Esito = restituisce ? { data: passa ? [{ id: riga().id }] : [], error: null } : { error: null };
      return Promise.resolve(esito).then(ok, ko);
    },
  };
  return q;
}
