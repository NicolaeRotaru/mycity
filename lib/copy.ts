/**
 * Microcopy centralizzato — single source of truth per strings UI ripetute.
 *
 * Esperti consultati:
 * - Content Designer: "Strings ripetute (Salva, Annulla, Caricamento) duplicate
 *   in 30+ posti = brand inconsistency. Centralizza in 1 file, casual+italiano."
 * - UX Writer: "Tono: caldo, diretto, italiano vivo. No anglicismi gratuiti.
 *   No 'click here', 'submit'. Sempre 'salva', 'invia', 'conferma'."
 */

export const COPY = {
  actions: {
    save:    'Salva',
    saving:  'Salvataggio…',
    cancel:  'Annulla',
    confirm: 'Conferma',
    delete:  'Elimina',
    edit:    'Modifica',
    back:    'Indietro',
    next:    'Avanti',
    close:   'Chiudi',
    retry:   'Riprova',
    submit:  'Invia',
    search:  'Cerca',
    add:     'Aggiungi',
    remove:  'Rimuovi',
  },
  states: {
    loading:    'Caricamento…',
    saving:     'Salvataggio…',
    sending:    'Invio…',
    processing: 'Elaborazione…',
    noResults:  'Nessun risultato',
    notFound:   'Non trovato',
  },
  errors: {
    generic:       'Qualcosa non ha funzionato. Riprova tra un momento.',
    network:       'Problema di connessione. Controlla la rete.',
    unauthorized:  'Devi accedere per continuare.',
    forbidden:     'Non hai i permessi per questa azione.',
    rateLimit:     'Troppe richieste. Aspetta qualche secondo.',
    sessionExpired:'La sessione è scaduta. Accedi di nuovo.',
    required:      'Campo obbligatorio',
    invalidEmail:  'Email non valida',
    invalidPhone:  'Numero di telefono non valido',
    passwordShort: 'Almeno 8 caratteri',
  },
  toasts: {
    saved:    'Salvato.',
    deleted:  'Eliminato.',
    sent:     'Inviato.',
    copied:   'Copiato negli appunti.',
    updated:  'Aggiornato.',
  },
} as const;

/**
 * Pluralizzatore italiano semplice (singolare/plurale).
 * Per casi più complessi (zero, due, molti) usa Intl.PluralRules.
 */
export function pluralize(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
