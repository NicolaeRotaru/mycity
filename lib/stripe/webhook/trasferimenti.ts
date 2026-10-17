/**
 * Storni di bonifico, bonifici bancari falliti, e stato del conto Connect
 * del venditore.
 *
 * #12 — Perché sta qui e non in `app/api/stripe/webhook/route.ts`.
 *
 * Quel file era uno solo, da mille righe, con dentro otto mestieri senza
 * rapporto fra loro: creazione ordini, buoni regalo, spazi sponsorizzati,
 * abbonamenti, rimborsi, contestazioni, storni, esiti dei pagamenti. Ogni
 * modifica ai buoni regalo si portava dietro il rischio di toccare la
 * creazione degli ordini, perché stavano nello stesso file e la revisione
 * mostrava un diff dentro un blocco da mille righe. È la strada su cui
 * passano tutti i soldi del marketplace: è l'ultimo posto dove si vuole una
 * revisione difficile da leggere.
 *
 * Nessuna logica è cambiata in questo spostamento: le prove esistenti sul
 * webhook sono la dimostrazione che non si è rotto niente.
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe/client';
import { applyConnectAccountStatus } from '@/lib/stripe/payout';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { notifyAdmins, provaAMandare } from './comune';
import { scritturaObbligatoria } from './esito';

/**
 * transfer.reversed → un transfer al seller/rider è stato revertito (claw-back o
 * azione Stripe). Sincronizza lo stato payout dell'ordine, così il DB non diverge
 * silenziosamente dalla realtà Stripe.
 */
export async function handleTransferReversed(transfer: Stripe.Transfer) {
  const admin = getAdminSupabase();

  // Stripe manda questo evento a OGNI storno, anche parziale. Marcare
  // 'REVERSED' senza guardare gli importi chiudeva la porta agli storni
  // successivi: reverseOrderTransfer parte solo da 'TRANSFERRED', quindi dopo un
  // rimborso parziale il resto non si poteva piu' recuperare.
  const stornato = transfer.amount_reversed ?? 0;
  const totale = transfer.amount ?? 0;
  const eTotale = totale > 0 ? stornato >= totale : true;

  if (!eTotale) {
    logger.info('[stripe] transfer.reversed parziale: stato invariato', {
      transferId: transfer.id, stornato, totale,
    });
    return;
  }

  // R81 — Uno storno non registrato lascia i conti sbagliati per sempre: se il
  // database dice di no, Stripe deve riprovare. Le due scritture riscrivono lo
  // stesso valore, quindi un secondo passaggio è innocuo.
  scritturaObbligatoria(
    await admin.from('orders').update({ payout_status: 'REVERSED' }).eq('stripe_transfer_id', transfer.id),
    'storno del bonifico al negozio',
  );
  scritturaObbligatoria(
    await admin.from('orders').update({ rider_payout_status: 'REVERSED' }).eq('rider_transfer_id', transfer.id),
    'storno del compenso al fattorino',
  );
  logger.info('[stripe] transfer.reversed sincronizzato', { transferId: transfer.id });
}

/**
 * account.updated → Stripe ha cambiato qualcosa sul conto di un negozio.
 *
 * 16/10/2026 — UN AVVISO VECCHIO RIMETTEVA UNO STATO SUPERATO.
 *
 * Qui si scriveva la fotografia del conto contenuta nell'avviso. Ma Stripe non
 * garantisce l'ordine di consegna, e un avviso la cui scrittura è fallita torna
 * anche ore dopo. Un caso: alle 10:00 un avviso dice «versamenti abilitati» e
 * la scrittura cade; alle 10:05 Stripe blocca i versamenti per un documento
 * mancante e il database scrive «bloccati»; alle 11:00 torna il primo avviso e
 * il database torna ad «abilitati». Il giro dei bonifici pagava un conto
 * bloccato. Adesso l'avviso dice solo QUALE conto è cambiato: lo stato si
 * rilegge da Stripe in quel momento, come fa già il tasto «Aggiorna stato»
 * (POST /api/stripe/connect/refresh-status). Se Stripe non risponde si lancia,
 * e Stripe riprova.
 */
export async function handleAccountUpdated(acct: Stripe.Account) {
  const contoAdesso = await getStripe().accounts.retrieve(acct.id);
  // R81 — Se Stripe blocca i versamenti di un negozio e il database non lo
  // registra, il giro dei bonifici continua a mandargli soldi che restano fermi
  // sul suo saldo: l'esito si legge, e su un errore Stripe riprova.
  scritturaObbligatoria(await applyConnectAccountStatus(contoAdesso), 'stato del conto Stripe del negozio');
}

/**
 * payout.failed → la banca del negozio ha rifiutato il bonifico.
 *
 * 6/9/2026 — LO SCOPRIVA SOLO L'AMMINISTRATORE, E SENZA SAPERE DI CHI ERA.
 *
 * Qui c'era una campanella e basta: un avviso agli amministratori col codice
 * del bonifico (`po_1abc`) e l'importo. Non il nome del negozio — l'evento
 * arriva da un conto Connect e nessuno risaliva al profilo — e soprattutto
 * nessun avviso al negoziante. Pane Quotidiano cambia IBAN, il bonifico di
 * 120 € rimbalza, e lui nella pagina Guadagni continua a leggere «versato»
 * mentre in banca non trova niente. Se ne accorge lui, giorni dopo.
 *
 * Adesso si risale al profilo dal conto Connect (`stripe_account_id`), si
 * avvisa il negoziante con il motivo e dove correggere l'IBAN, e il nome del
 * negozio entra anche nell'avviso agli amministratori.
 *
 * COSA NON SI FA, DI PROPOSITO: non si rimettono gli ordini in coda al giro
 * dei bonifici. `payout_status = 'TRANSFERRED'` racconta il trasferimento
 * dalla piattaforma al conto Stripe del negozio, che è RIUSCITO: qui a
 * fallire è il passaggio successivo, dal conto Stripe alla sua banca, e i
 * soldi sono ancora sul suo saldo Stripe. Riaprire quegli ordini farebbe
 * partire un secondo trasferimento — cioè pagherebbe il negozio due volte.
 * Il rimedio è l'IBAN corretto: da lì Stripe riprova da solo.
 *
 * Nessuno dei due avvisi fa fallire il gestore: un avviso non partito non
 * deve far ritentare a Stripe un evento che non muove soldi.
 */
export async function handlePayoutFailed(payout: Stripe.Payout, accountId?: string | null) {
  const admin = getAdminSupabase();
  const importo = ((payout.amount ?? 0) / 100).toFixed(2);
  const motivo = payout.failure_message ?? 'motivo sconosciuto';

  // Il conto Connect è l'unico filo che porta al negozio: l'evento non nomina
  // nessuno. `payout.destination` è il conto bancario, non il profilo.
  let negozio: { id: string; store_name: string | null } | null = null;
  if (accountId) {
    const { data, error } = await admin
      .from('profiles')
      .select('id, store_name')
      .eq('stripe_account_id', accountId)
      .limit(1);
    if (error) logger.error(error, { context: 'payout-failed-profilo', accountId });
    negozio = (data?.[0] as { id: string; store_name: string | null } | undefined) ?? null;
  }

  if (negozio) {
    const destinatario = negozio.id;
    await provaAMandare('avviso di bonifico rifiutato al negozio', { payoutId: payout.id, sellerId: destinatario }, async () => {
      const { error } = await admin.from('notifications').insert({
        user_id: destinatario,
        // 'system': un avviso di servizio non si spegne dagli interruttori
        // delle notifiche, e questo è il tipo di cosa che si deve sapere.
        category: 'system',
        title: '⚠️ Il bonifico non è arrivato in banca',
        body:
          `La tua banca ha rifiutato il versamento di ${importo} €: ${motivo}. ` +
          'Controlla l\'IBAN nei dati di pagamento del negozio: appena è corretto Stripe riprova da solo.',
        link: '/seller/earnings',
      });
      if (error) throw new Error(error.message);
    });
  }

  const chi = negozio
    ? negozio.store_name?.trim() || `il negozio ${negozio.id.slice(0, 8)}`
    : 'un negozio non riconosciuto';
  await provaAMandare('avviso di bonifico rifiutato agli amministratori', { payoutId: payout.id }, () =>
    notifyAdmins(
      '⚠️ Bonifico al negozio rifiutato dalla banca',
      `Il versamento di ${importo} € a ${chi} è stato rifiutato: ${motivo}. Bonifico ${payout.id}.` +
        (negozio
          ? ' Il negoziante è stato avvisato di correggere l\'IBAN.'
          : ' Il conto Connect non è riconosciuto qui: va cercato su Stripe, e il negoziante non sa niente.'),
      '/admin',
    ),
  );

  logger.warn('[stripe] payout.failed', {
    payoutId: payout.id, accountId: accountId ?? null, sellerId: negozio?.id ?? null, failure: payout.failure_message,
  });
}
