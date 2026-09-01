/**
 * 31/8/2026 (R193) — I TRE NUMERI DELLA CODA EMAIL, IN UNA CASA SOLA.
 *
 * Stanno qui e non dentro `app/api/cron/send-emails/route.ts` per un motivo
 * pratico: un file di rotta puo' esportare solo i verbi HTTP e la sua
 * configurazione, e `next build` boccia tutto il resto. Esportarli da li'
 * passava il controllo dei tipi e faceva fallire la costruzione dell'app.
 */
/**
 * 31/8/2026 (R193) — QUANTE NE MANDIAMO E QUANDO SUONA L'ALLARME ERANO DUE
 * NUMERI CHE NON SI PARLAVANO.
 *
 * Qui si prendono quindici messaggi per giro, e il giro parte ogni dieci minuti
 * (`vercel.json` → `crons`): novanta messaggi l'ora. Dall'altra parte del sito —
 * `app/api/cron/operational-alerts/route.ts` — un allarme suona quando cinquanta
 * messaggi risultano fermi da piu' di mezz'ora. Nessuno dei due numeri sapeva
 * dell'altro: bastava alzare il tetto qui per trasformare quell'allarme in un
 * falso allarme, o abbassarlo per farlo suonare quando ormai il ritardo era di
 * ore. E non essendo scritto da nessuna parte che erano legati, chiunque poteva
 * toccarne uno in buona fede.
 *
 * Il legame e' questo. Cinquanta messaggi fermi, a quindici per giro, sono
 * QUATTRO giri: il primo parte subito, gli altri tre a dieci minuti l'uno
 * dall'altro, quindi la coda si svuota in trenta minuti — se nel frattempo non
 * ne arrivano altri. Trenta minuti e' esattamente la finestra che ha fatto
 * suonare l'allarme: quando suona, la coda e' profonda quanto l'attesa che l'ha
 * resa visibile, cioe' un'ora tonda dal primo messaggio in ritardo all'ultimo
 * spedito. Piu' in basso suonerebbe per una coda che si smaltisce da sola prima
 * che qualcuno si alzi; piu' in alto tacerebbe mentre il ritardo diventa di ore.
 *
 * Cosa NON c'e' in questa coda: le conferme d'ordine. Quelle partono dirette da
 * `sendEmail` (`lib/stripe/webhook/ordini.ts`, `app/api/orders/cod/route.ts`) e
 * non passano di qui. In coda ci sono il benvenuto, il tutorial, «ordine
 * pronto», «ordine consegnato» e i messaggi commerciali: una coda indietro
 * ritarda quelli, non l'incasso.
 *
 * Da qui in avanti il legame e' scritto una volta sola, in
 * `sogliaAllarmeCoerente`. A metterlo alla prova sui numeri VERI — quelli che
 * le due rotte usano davvero, piu' la cadenza letta da `vercel.json` — e'
 * tests/unit/l-allarme-della-coda-email-segue-quanto-in-fretta-la-svuotiamo.test.ts:
 * chi cambia uno dei tre senza gli altri lo trova rosso.
 *
 * La manovra da fare quando l'allarme suona sta in `docs/runbook.md`, §6-bis.
 */
export const EMAIL_PER_GIRO = 15;

/**
 * Quanti minuti servono per svuotare una coda di `inCoda` messaggi, se nel
 * frattempo non ne arrivano altri. Il primo giro parte subito, gli altri
 * aspettano il loro turno: e' per questo che i giri si contano meno uno.
 */
export function minutiPerSmaltire(
  inCoda: number,
  perGiro: number,
  minutiFraUnGiroELAltro: number,
): number {
  if (inCoda <= 0) return 0;
  const giri = Math.ceil(inCoda / perGiro);
  return (giri - 1) * minutiFraUnGiroELAltro;
}

/**
 * Il legame fra la soglia dell'allarme e la velocita' con cui la coda si
 * svuota, in una regola sola.
 *
 * Una soglia e' buona quando sta nella prima fascia utile: abbastanza alta da
 * non suonare per una coda che si smaltisce dentro la finestra di attesa,
 * abbastanza bassa da suonare appena la coda supera quel punto. Fuori di li'
 * l'allarme e' rumore o arriva tardi — e in tutti e due i casi, alle tre di
 * notte, non serve a niente.
 */
export function sogliaAllarmeCoerente(numeri: {
  /** Quanti messaggi fermi fanno suonare l'allarme. */
  soglia: number;
  /** Da quanti minuti devono essere fermi perche' contino. */
  minutiDiRitardo: number;
  /** Quanti ne spedisce un giro. */
  perGiro: number;
  /** Ogni quanti minuti parte un giro. */
  minutiFraUnGiroELAltro: number;
}): { coerente: boolean; motivo: string } {
  const { soglia, minutiDiRitardo, perGiro, minutiFraUnGiroELAltro } = numeri;
  const allOra = Math.round((60 / minutiFraUnGiroELAltro) * perGiro);
  const perLaSoglia = minutiPerSmaltire(soglia, perGiro, minutiFraUnGiroELAltro);
  const perUnGiroPrima = minutiPerSmaltire(soglia - perGiro, perGiro, minutiFraUnGiroELAltro);
  const premessa =
    `Spediamo ${perGiro} messaggi ogni ${minutiFraUnGiroELAltro} minuti (${allOra} l'ora) e l'allarme suona ` +
    `a ${soglia} messaggi fermi da ${minutiDiRitardo} minuti.`;

  if (perLaSoglia < minutiDiRitardo) {
    return {
      coerente: false,
      motivo:
        `${premessa} Quei ${soglia} messaggi li smaltiamo in ${perLaSoglia} minuti, meno dei ` +
        `${minutiDiRitardo} di attesa che li ha resi visibili: l'allarme sveglia qualcuno per una coda ` +
        `che si svuota da sola prima che apra il portatile.`,
    };
  }
  if (perUnGiroPrima >= minutiDiRitardo) {
    return {
      coerente: false,
      motivo:
        `${premessa} Ma gia' a ${soglia - perGiro} messaggi servono ${perUnGiroPrima} minuti per ` +
        `smaltirli, cioe' la coda e' fuori finestra e l'allarme tace ancora: quando finalmente suona ` +
        `il ritardo e' di ore e i clienti hanno gia' aspettato.`,
    };
  }
  return {
    coerente: true,
    motivo:
      `${premessa} Sono ${Math.ceil(soglia / perGiro)} giri, ${perLaSoglia} minuti per tornare in pari: ` +
      `l'allarme suona quando la coda e' profonda quanto la finestra che l'ha fatta suonare.`,
  };
}
