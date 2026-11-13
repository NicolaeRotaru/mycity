/**
 * Il numero WhatsApp del piè di pagina — e perché un segnaposto non è un numero.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IL DIFETTO CHE QUESTO FILE CHIUDE
 * ─────────────────────────────────────────────────────────────────────────────
 * Nel piè di pagina ci sono due punti di contatto WhatsApp: l'icona verde nella fila social e la
 * voce «WhatsApp Business» nella colonna Aiuto. Tutt'e due portavano a **393000000000** — un numero
 * che non esiste. Il primo lo aveva scritto a mano; il secondo leggeva la variabile d'ambiente ma
 * col segnaposto come valore di ripiego, e nel file d'esempio quella variabile è dichiarata vuota.
 *
 * Quindi finché nessuno la configura sono rotti **tutti e due**, non uno.
 *
 * Il piè di pagina sta su ogni pagina del sito. Chi tocca l'icona verde apre WhatsApp su un
 * contatto inesistente — e chi lo fa è qualcuno che stava cercando aiuto.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA CURA C'ERA GIÀ NELLO STESSO FILE, DUE SCHERMATE PIÙ IN BASSO
 * ─────────────────────────────────────────────────────────────────────────────
 * I dati legali del titolare si stampano **solo se esistono davvero**, e il commento accanto
 * racconta perché: prima c'erano una sede, una P.IVA di soli zeri e una PEC inventati, su ogni
 * pagina. Finché non c'è una partita IVA attiva, quella riga non si stampa affatto.
 *
 * Stessa regola qui. Un contatto che non esiste non si mostra: **un'icona in meno è meglio di
 * un'icona che porta nel vuoto.**
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PERCHÉ NON BASTA «SE LA VARIABILE È VUOTA»
 * ─────────────────────────────────────────────────────────────────────────────
 * Il valore di ripiego è il segnaposto. Se domani qualcuno riempie la variabile copiandoci dentro
 * il valore d'esempio — che è il modo più naturale di sbagliare — il controllo «è vuota?» direbbe
 * di sì e il numero finto tornerebbe a video. Un numero fatto di zeri va riconosciuto per quello
 * che è, non per il posto da cui arriva.
 *
 * Prova: tests/unit/il-numero-whatsapp-che-non-esiste.test.ts
 */

/** Il segnaposto che stava scritto a mano nel codice e nel file d'esempio. */
export const SEGNAPOSTO = '393000000000';

/** Sotto questa lunghezza non è un numero di telefono, è un refuso. */
const CIFRE_MINIME = 8;

/**
 * Il numero da usare, o `null` se non ce n'è uno vero.
 *
 * Tre modi di non averlo, e portano tutti allo stesso posto: non configurato · troppo corto per
 * essere un numero · fatto di zeri dopo il prefisso, cioè un segnaposto travestito.
 */
export function numeroWhatsApp(grezzo?: string | null): string | null {
  const cifre = String(grezzo ?? '').replace(/[^0-9]/g, '');
  if (!cifre) return null;
  if (cifre.length < CIFRE_MINIME) return null;
  if (cifre === SEGNAPOSTO) return null;
  // Un numero vero non è tutto zeri dopo il prefisso internazionale. Il segnaposto sì, e così ogni
  // sua variante scritta a mano: 39 000…, 39 3000000000, e le altre che nascono copiando l'esempio.
  if (/^0+$/.test(cifre.slice(3))) return null;
  // R22-014 — Gli stessi controlli sul numero normalizzato: con 0039 davanti il segnaposto o i soli
  // zeri sfuggivano ai controlli sulle cifre grezze.
  const numero = conPrefissoItaliano(String(grezzo ?? ''), cifre);
  if (numero === SEGNAPOSTO || /^0+$/.test(numero.slice(3))) return null;
  return numero;
}

/**
 * 13/11/2026 (R22-014) — Il numero scritto all'italiana prende il 39.
 *
 * wa.me legge le prime cifre come prefisso del paese: «333 1234567» senza +39 apriva il 33, la
 * Francia, e chi cercava aiuto finiva su un contatto che non è il nostro. È la stessa regola di
 * `numeroWhatsappItaliano` (lib/store-customization.ts, la 580, per il bottone della vetrina):
 * 0039 e +39 restano 39, un cellulare (3…) o un fisso (0…) scritti senza prefisso lo prendono.
 * Non la si importa da lì perché quel modulo si porta dietro zod e i cataloghi della vetrina, e
 * questo file sta nel piè di pagina di ogni pagina.
 */
function conPrefissoItaliano(scritto: string, cifre: string): string {
  if (cifre.startsWith('00')) return cifre.slice(2);
  if (scritto.trim().startsWith('+')) return cifre;
  if (cifre.startsWith('39') && cifre.length >= 11) return cifre;
  if (/^3\d{8,9}$/.test(cifre) || cifre.startsWith('0')) return `39${cifre}`;
  return cifre;
}

/** Il link da mettere nell'ancora, o `null` se non c'è un numero: allora l'ancora non si disegna. */
export function linkWhatsApp(grezzo?: string | null, testo?: string): string | null {
  const numero = numeroWhatsApp(grezzo);
  if (!numero) return null;
  const coda = testo ? `?text=${encodeURIComponent(testo)}` : '';
  return `https://wa.me/${numero}${coda}`;
}
