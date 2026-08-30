import { titolare } from '@/lib/legal/titolare';
import type { ServiceHealth } from './checks';

/**
 * 22/8/2026 — I DATI DEL TITOLARE NON ERANO DICHIARATI DA NESSUNA PARTE.
 *
 * L'informativa privacy, i termini e la pagina dei contatti leggono nove
 * variabili con dentro nome, indirizzo, partita IVA, PEC e capitale sociale.
 * Nessuna delle nove era dichiarata fra le variabili del progetto.
 *
 * E c'e' un dettaglio che rende il difetto peggiore di quanto sembri: quelle
 * variabili finiscono dentro il pacchetto al momento in cui il sito viene
 * COMPILATO. Se mancano in quel momento restano vuote per sempre nel sito
 * pubblicato — metterle dopo non basta, serve ricompilare. Il codice ripiega su
 * un generico «MyCity» e omette il resto, quindi la pagina esce senza errori e
 * sembra a posto.
 *
 * Un'informativa privacy senza i dati del titolare non e' un'informativa: e'
 * quello che un'ispezione guarda per primo.
 *
 * Qui non si puo' riempirle — sono decisioni e dati veri di Nicola — ma si puo'
 * smettere di far finta che vada tutto bene. Se mancano, la salute dice
 * «degradato» e la pagina lo mostra.
 */

/**
 * 30/8/2026 (R192) — LE VARIABILI CHE NESSUNO SAPEVA DI DOVER METTERE.
 *
 * Le Condizioni d'uso promettono al cliente cinque caselle di posta: resi,
 * reclami, ufficio legale, sicurezza, segnalazioni. Ognuna di quelle righe si
 * stampa solo se la variabile c'e' — e le cinque variabili non comparivano da
 * nessuna parte in `.env.example`, quindi non esisteva un posto dove accorgersi
 * che mancavano. Risultato: la pagina delle Condizioni usciva piu' corta, senza
 * errori, e il cliente che cerca dove mandare un reso non trova niente.
 *
 * Il controllo di salute guardava solo indirizzo, partita IVA, PEC e
 * denominazione. Adesso nomina anche le cinque caselle, una per una.
 *
 * Nota per chi le mette: hanno il prefisso `NEXT_PUBLIC_`, cioe' entrano nel
 * sito quando lo si COMPILA. Metterle su Vercel dopo non basta: va rifatto il
 * build.
 *
 * Sta in un file suo, e non dentro `checks.ts`, perche' quello apre con
 * `import 'server-only'` e non si puo' aprire da una prova.
 */
export function svcTitolare(status: ServiceHealth['status'], detail: string | null): ServiceHealth {
  return {
    id: 'titolare',
    name: 'Dati del titolare',
    description: 'Informativa privacy e termini',
    status,
    latencyMs: null,
    detail,
  };
}

export function checkTitolare(): ServiceHealth {
  const dati = titolare();
  const mancanti: string[] = [];
  if (!dati.indirizzo) mancanti.push('indirizzo');
  if (!dati.partitaIva) mancanti.push('partita IVA');
  if (!dati.pec) mancanti.push('PEC');
  if (dati.denominazione === 'MyCity') mancanti.push('denominazione');
  // Le cinque caselle promesse dalle Condizioni: senza, quelle righe spariscono.
  if (!dati.emailResi) mancanti.push('email resi (recesso)');
  if (!dati.emailReclami) mancanti.push('email reclami');
  if (!dati.emailLegale) mancanti.push('email legale');
  if (!dati.emailSicurezza) mancanti.push('email sicurezza');
  if (!dati.emailSegnalazioni) mancanti.push('email segnalazioni');

  return svcTitolare(
    mancanti.length === 0 ? 'operational' : 'unknown',
    mancanti.length === 0
      ? null
      : `Mancano nelle variabili del progetto: ${mancanti.join(', ')}. Vanno messe PRIMA di ricompilare.`,
  );
}
