/**
 * Un finto mondo per far girare davvero la cancellazione di un account.
 *
 * Non finge il risultato: finge il database, lo storage e il servizio di
 * accesso, e tiene il DIARIO ordinato di tutto quello che la pipeline fa, nel
 * momento in cui lo fa. Serve perché in questa storia l'ordine è il difetto:
 * svuotare il profilo prima o dopo aver chiuso l'account non è la stessa cosa,
 * e una prova che guarda solo lo stato finale non se ne accorge.
 */

export type VoceDiario =
  | { op: 'select'; tabella: string }
  | { op: 'update'; tabella: string; valori: Record<string, unknown>; colonna: string; valore: string }
  | { op: 'delete'; tabella: string }
  | { op: 'file-rimossi'; secchio: string; percorsi: string[] }
  | { op: 'cancella-account' };

export type Scenario = {
  /** Le giornate di cassa contanti del fattorino (tabella `cod_reconciliations`). */
  cassa?: Array<Record<string, unknown>>;
  /** Il registro della cassa risponde con un errore invece che con le righe. */
  erroreCassa?: string;
  /** Gli ordini della persona: da lì si arriva alle foto della consegna. */
  ordini?: Array<Record<string, unknown>>;
  /** Il motivo per cui la cancellazione dell'account fallisce (vuoto = riesce). */
  cancellazioneFallisce?: string;
  /** L'indirizzo email dell'utente, quello che serve per la newsletter. */
  email?: string;
};

export function fintoMondo(scenario: Scenario = {}) {
  const diario: VoceDiario[] = [];

  const admin = {
    from(tabella: string) {
      return {
        select(_colonne: string) {
          return {
            eq: async (_colonna: string, _valore: string) => {
              diario.push({ op: 'select', tabella });
              if (tabella === 'cod_reconciliations') {
                if (scenario.erroreCassa) return { data: null, error: { message: scenario.erroreCassa } };
                return { data: scenario.cassa ?? [], error: null };
              }
              if (tabella === 'orders') return { data: scenario.ordini ?? [], error: null };
              return { data: [], error: null };
            },
          };
        },
        update(valori: Record<string, unknown>) {
          return {
            eq: async (colonna: string, valore: string) => {
              diario.push({ op: 'update', tabella, valori, colonna, valore });
              return { error: null };
            },
          };
        },
        delete() {
          return {
            ilike: async () => {
              diario.push({ op: 'delete', tabella });
              return { error: null };
            },
          };
        },
      };
    },
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: scenario.email ?? 'maria.rossi@example.it' } } }),
        deleteUser: async () => {
          diario.push({ op: 'cancella-account' });
          return scenario.cancellazioneFallisce
            ? { error: { message: scenario.cancellazioneFallisce } }
            : { error: null };
        },
      },
    },
    storage: {
      from(secchio: string) {
        return {
          list: async () => ({ data: [], error: null }),
          remove: async (percorsi: string[]) => {
            diario.push({ op: 'file-rimossi', secchio, percorsi });
            return { error: null };
          },
        };
      },
    },
  };

  return { admin, diario };
}

/** Gli aggiornamenti finiti su una tabella, in ordine. */
export function aggiornamentiSu(diario: VoceDiario[], tabella: string) {
  return diario.filter((v): v is Extract<VoceDiario, { op: 'update' }> => v.op === 'update' && v.tabella === tabella);
}

/** A che punto del diario è stato chiuso l'account. -1 se non è mai successo. */
export function quandoChiudeLAccount(diario: VoceDiario[]): number {
  return diario.findIndex((v) => v.op === 'cancella-account');
}
