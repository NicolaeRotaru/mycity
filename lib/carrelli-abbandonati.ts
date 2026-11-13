import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { COLONNE_148, scriviAncheSeMancaUnaColonnaNuova } from '@/lib/db/migrazione-148';

/**
 * IL CARRELLO ABBANDONATO CHE TORNA — e come si fa a saperlo.
 *
 * 30/8/2026 (R164) — LA CAMPAGNA DI RECUPERO GIRAVA ALLA CIECA.
 *
 * `abandoned_carts` ha da sempre una colonna `recovered`, e la funzione che
 * sceglie chi ricontattare filtra su `recovered = false`. Ma quel `true` non lo
 * scriveva NESSUNO, in nessun punto del progetto: la colonna era nata e rimasta
 * a zero. E la riga spariva del tutto al momento dell'acquisto, perché il
 * browser, a ordine fatto, svuotava il carrello e con lui cancellava la copia
 * sul server. Il carrello recuperato si cancellava nell'istante esatto in cui
 * diventava una notizia.
 *
 * Conseguenza: una delle poche leve di ricavo già costruite — l'email «hai
 * dimenticato qualcosa» — non si poteva misurare, quindi non si poteva
 * decidere se tenerla, cambiarla o spegnerla.
 *
 * Il browser lo marca da solo (`clearCart({ dopoUnOrdine: true })`), ma il
 * browser può chiudersi: chi paga e chiude la scheda non passa mai di lì. Qui
 * lo fa il server, dove l'ordine è un fatto certo. Le due strade scrivono la
 * stessa cosa e non si danno fastidio.
 */

/** Da quanti giorni una riga già recuperata non serve più a nessuno. */
export const GIORNI_DI_MEMORIA_CARRELLI = 90;

/**
 * Il carrello di questa persona è tornato: è diventato un ordine.
 *
 * Non lancia mai. Un ordine è già stato scritto e pagato: una misura che non
 * riesce non deve poter far ritentare un webhook o far fallire una cassa.
 *
 * 3/9/2026 — E NON SI ARRENDE SE IL DATABASE È INDIETRO DI UNA MIGRAZIONE.
 *
 * `recovered_at` arriva con la migrazione 148, che si applica a mano: finché
 * non è firmata, il database rifiutava questa riga INTERA — non «senza quella
 * colonna»: tutta. Questa è la strada che conta più dell'altra, perché chi paga
 * con la carta e chiude la scheda non passa mai dal browser che marca: se cade
 * qui, il mattino dopo riceve «hai lasciato qualcosa nel carrello» dopo aver
 * pagato. Ora, se il rifiuto è per la colonna nuova, si riscrive senza quella:
 * si perde il QUANDO, non il fatto. La regola sta in un posto solo, insieme al
 * gemello nel browser (`lib/cart-sync.ts`).
 */
export async function marcaCarrelloRecuperato(
  admin: SupabaseClient,
  userId: string,
  oraIso = new Date().toISOString(),
): Promise<void> {
  try {
    const esito = await scriviAncheSeMancaUnaColonnaNuova(
      'il carrello di chi ha appena comprato',
      { recovered: true, recovered_at: oraIso },
      COLONNE_148,
      (campi) =>
        admin.from('abandoned_carts').update(campi).eq('user_id', userId).eq('recovered', false),
    );
    if (esito.avviso) {
      logger.warn(`[carrelli] ${esito.avviso}`, { riuscita: esito.riuscita });
    }
  } catch (e) {
    logger.warn('[carrelli] recupero non registrato', {
      message: e instanceof Error ? e.message : 'unknown',
    });
  }
}

/**
 * QUANTO RENDE DAVVERO L'EMAIL «HAI DIMENTICATO QUALCOSA».
 *
 * 6/9/2026 — «RECUPERATO» RISPONDEVA A DUE DOMANDE DIVERSE. `marcaCarrelloRecuperato`
 * mette `recovered = true` su ogni carrello di chi ha appena comprato, e fa bene:
 * serve a non mandare l'email di un carrello già diventato ordine. Ma nella
 * colonna finiscono insieme due persone diverse: chi è tornato GRAZIE all'email
 * e chi è tornato da solo dieci minuti dopo, senza aver ricevuto niente.
 *
 * Chi un giorno guarderà «quanto rende il recupero carrelli» contando le righe
 * con `recovered = true` leggerà un numero più alto del vero, e terrà accesa una
 * leva che magari non porta niente. È una delle poche leve di ricavo già
 * costruite: decidere su un numero gonfiato costa tempo e fiducia.
 *
 * Le due domande hanno già due campi: `recovery_email_sent_at` dice se l'email è
 * partita, `recovered_at` quando il carrello è tornato. Serviva la funzione che
 * li mette insieme, in un posto solo, accanto a chi scrive quel dato — così il
 * numero non se lo inventa ogni cruscotto per conto suo.
 *
 * 🟢 Pura: conta righe già lette, niente rete. Una prova la ESEGUE.
 */
export type RigaDiRecupero = {
  recovered?: boolean | null;
  recovered_at?: string | null;
  recovery_email_sent_at?: string | null;
  /** Serve a riconoscere il carrello chiuso SENZA email (vedi `chiusoSenzaEmail`). */
  last_activity?: string | null;
};

/**
 * R14-009 — IL CARRELLO CHIUSO SENZA EMAIL NON E' UN PROMEMORIA INVIATO.
 *
 * Il giro (app/api/cron/abandoned-carts) chiude senza scrivere il carrello
 * troppo vecchio e quello di chi non ha dato il consenso: li segna «gestiti»
 * con lo stesso `recovery_email_sent_at` dell'invio, e qui contavano come email
 * partite. Adesso il giro mette in quel segno l'ora dell'ultima attivita' del
 * carrello. Un'email vera parte almeno quattro ore dopo l'ultima attivita':
 * segno UGUALE all'ultima attivita' vuol dire «gestito, nessuna email».
 * (I carrelli chiusi prima di questa riparazione hanno l'ora della marcatura e
 * non si distinguono piu'.)
 */
function chiusoSenzaEmail(riga: RigaDiRecupero): boolean {
  const segno = riga.recovery_email_sent_at ? Date.parse(riga.recovery_email_sent_at) : NaN;
  const ultima = riga.last_activity ? Date.parse(riga.last_activity) : NaN;
  return Number.isFinite(segno) && Number.isFinite(ultima) && segno === ultima;
}

export type RendimentoRecupero = {
  /** A quanti è partita l'email «hai dimenticato qualcosa». */
  emailInviate: number;
  /** Quanti carrelli sono tornati, per qualunque motivo. È il numero che si leggeva prima. */
  tornatiInTutto: number;
  /** Quanti sono tornati DOPO aver ricevuto l'email: questo è il rendimento della campagna. */
  tornatiDopoLEmail: number;
  /** Tornati senza aver mai ricevuto l'email: sarebbero tornati comunque. */
  tornatiDaSoli: number;
  /**
   * Tornati con l'email partita ma senza il QUANDO: succede solo se la
   * migrazione 148 non è ancora applicata (`recovered_at` assente). Non si
   * contano nel rendimento — dichiararli è meglio che gonfiare il numero.
   */
  tornatiSenzaData: number;
};

export function contaRendimentoRecupero(righe: RigaDiRecupero[]): RendimentoRecupero {
  const conto: RendimentoRecupero = {
    emailInviate: 0,
    tornatiInTutto: 0,
    tornatiDopoLEmail: 0,
    tornatiDaSoli: 0,
    tornatiSenzaData: 0,
  };
  for (const riga of righe) {
    const inviata = chiusoSenzaEmail(riga) ? null : (riga.recovery_email_sent_at ?? null);
    if (inviata) conto.emailInviate++;
    if (!riga.recovered) continue;
    conto.tornatiInTutto++;
    if (!inviata) {
      conto.tornatiDaSoli++;
      continue;
    }
    const tornatoIl = riga.recovered_at ?? null;
    if (!tornatoIl) {
      conto.tornatiSenzaData++;
      continue;
    }
    // L'ordine dei due istanti conta: un carrello marcato PRIMA dell'invio non
    // è merito dell'email (succede quando la riga viene riusata).
    if (new Date(tornatoIl).getTime() >= new Date(inviata).getTime()) conto.tornatiDopoLEmail++;
    else conto.tornatiDaSoli++;
  }
  return conto;
}

/** Lo stesso conto, leggendo le righe vere. Solo le colonne che servono (mai `cart_data`). */
export async function rendimentoRecuperoCarrelli(admin: SupabaseClient): Promise<RendimentoRecupero> {
  const { data, error } = await admin
    .from('abandoned_carts')
    .select('recovered, recovered_at, recovery_email_sent_at, last_activity');
  if (error) {
    logger.warn('[carrelli] rendimento del recupero non letto', { message: error.message });
    return contaRendimentoRecupero([]);
  }
  return contaRendimentoRecupero((data ?? []) as RigaDiRecupero[]);
}

/**
 * Le righe già recuperate da più di `GIORNI_DI_MEMORIA_CARRELLI` si potano.
 *
 * Servono a misurare, e una misura vecchia di tre mesi l'ha già letta chi
 * doveva. Tenerle per sempre vorrebbe dire conservare la spesa di una persona
 * senza motivo — e questa è la ragione vera del taglio, non lo spazio.
 */
export async function potaCarrelliRecuperati(
  admin: SupabaseClient,
  oraMs = Date.now(),
): Promise<number> {
  const limite = new Date(oraMs - GIORNI_DI_MEMORIA_CARRELLI * 86_400_000).toISOString();
  /*
   * 5/11/2026 — Si potavano solo i carrelli recuperati CON la data: i carrelli mai comprati
   * (recovered = false) e quelli recuperati senza `recovered_at` (scritti prima della 148 o dalla
   * strada di ripiego) restavano per sempre. Adesso anche loro, quando la loro ultima attività ha
   * più di `GIORNI_DI_MEMORIA_CARRELLI` giorni.
   */
  const tagli = [
    () => admin.from('abandoned_carts').delete().eq('recovered', true).lt('recovered_at', limite).select('user_id'),
    () => admin.from('abandoned_carts').delete().eq('recovered', false).lt('last_activity', limite).select('user_id'),
    () =>
      admin.from('abandoned_carts').delete().eq('recovered', true).is('recovered_at', null).lt('last_activity', limite).select('user_id'),
  ];
  let potate = 0;
  for (const taglio of tagli) {
    const { data, error } = await taglio();
    if (error) {
      logger.warn('[carrelli] potatura non riuscita', { message: error.message });
      continue;
    }
    potate += (data ?? []).length;
  }
  return potate;
}
