import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { contanteDaRimettereCents } from '@/lib/shipping';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { giornoLocale } from '@/lib/tempo/giorno-locale';
import { aggiornaQuadratura } from '@/lib/cassa/quadratura';
import { formatPriceFromCents } from '@/lib/format';
import { NOTA_SENZA_FOTO_MAX, valutaProvaIncasso } from '@/lib/cassa/prova-incasso';
import {
  COLONNE_ORDINE_DA_INCASSARE,
  campiDellIncasso,
  importoFuoriMisura,
  motivoPerNonRegistrare,
  scriviIncasso,
  tracciaIncassoSenzaFoto,
  type ChiRegistra,
  type OrdineDaIncassare,
} from '@/lib/cassa/registra-incasso';

export const runtime = 'nodejs';

/**
 * Percorso dentro il secchio privato `cod-proof`, non un indirizzo pubblico.
 * Le prove d'incasso non stanno piu' nel secchio pubblico, quindi qui arriva
 * `<utente>/<ordine>/cash-....jpg`. Vietati i due punti (nessun http://) e i
 * passi indietro (`..`), per non poter uscire dalla propria cartella.
 */
const PercorsoProva = z
  .string()
  .max(300)
  .regex(/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/, 'Percorso non valido')
  .refine((v) => !v.includes('..'), 'Percorso non valido');

/**
 * 16/10/2026 — `null` VUOL DIRE «NIENTE FOTO», NON «DATI NON VALIDI».
 *
 * Il pannello dei contanti mandava `"photoUrl": null` quando il fattorino non
 * scattava la foto (facoltativa), e qui i campi accettavano solo «testo oppure
 * assente»: 400 «Dati non validi» su qualunque importo. Dal lotto R33 l'incasso
 * viene prima del codice del cliente, quindi quel 400 era una consegna che non
 * si chiudeva piu'. Il pannello adesso non manda piu' `null`, ma le versioni
 * gia' nei telefoni si': per questo qui `null` vale come assente.
 *
 * `nota`: da 50 euro in su, chi non riesce a fare la foto scrive il perche'.
 * La regola sta in `lib/cassa/prova-incasso.ts`, la stessa che usa il pannello.
 */
const Body = z.object({
  orderId: z.string().uuid(),
  cashCollectedCents: z.number().int().nonnegative(),
  photoUrl: PercorsoProva.nullish(),
  signatureUrl: PercorsoProva.nullish(),
  deliveryPhotoUrl: PercorsoProva.nullish(),
  nota: z.string().max(NOTA_SENZA_FOTO_MAX).nullish(),
});

/** Tolleranza per arrotondamenti prima di considerarlo un mismatch. */
const MISMATCH_TOLERANCE_CENTS = 50; // €0,50

/**
 * Il rider conferma di aver incassato contanti al momento della consegna.
 *
 * Salva:
 *  - cash_collected_cents (importo)
 *  - cash_photo_url (foto contanti/scontrino)
 *  - cash_signature_url (firma digitale buyer, opzionale)
 *  - delivery_photo_url (foto pacco lasciato)
 *  - cash_confirmed_at + cash_collected_by
 *
 * Aggiorna il record cod_reconciliations per la giornata (anche
 * giornaliera): expected viene calcolato come somma total_price di
 * tutti gli ordini COD delivered dal rider quel giorno.
 *
 * RLS-safe: il rider puo' aggiornare solo i propri ordini con
 * delivery_status PICKED_UP/OUT_FOR_DELIVERY/DELIVERED (controllo
 * server-side).
 */
// Rate limit: 60 conferme / ora per rider (anti-abuse, ma rider attivi ~30/giorno)
export const POST = withAuthRateLimit({ name: 'rider-cash-confirm', max: 60, windowMs: 60 * 60_000 }, async ({ user, req }): Promise<NextResponse> => {
  let body;
  try {
    body = Body.parse(await jsonRichiesta(req, TETTO_JSON));
  } catch (e) {
  /**
   * 6/9/2026 — «TROPPO GRANDE» E «DATI NON VALIDI» NON SONO LA STESSA COSA.
   *
   * Il tetto sul corpo lancia un errore che porta con sé lo stato giusto (413).
   * Questo `catch` lo raccoglieva insieme a un JSON rotto e rispondeva 400
   * «Dati non validi»: chi manda troppa roba non capisce che deve solo mandarne
   * meno, e nei registri un limite superato non si distingue da un errore del
   * browser. Le rotte AI questa distinzione ce l'hanno da fine agosto (R153),
   * queste tre no.
   */
    if (e instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge('La richiesta è troppo grande: manda una foto più leggera.');
    return ApiErrors.invalidRequest('Dati non validi', e instanceof Error ? e.message : undefined);
  }

  // 15/10/2026 (R33) — L'ORDINE SI LEGGE COL CLIENT DI SERVIZIO, NON CON LA
  // SESSIONE DEL FATTORINO.
  //
  // Con la sessione la lettura passava dalla regola sugli ordini, che ai
  // fattorini nasconde i consegnati da piu' di sette giorni (127, ⑯: e' giusto,
  // li' dentro ci sono nome, telefono e indirizzo del cliente). Ma qui non si
  // legge nessun recapito, e il risultato era che chi aveva chiuso la consegna
  // senza dichiarare i contanti, passata una settimana, riceveva «Ordine non
  // trovato»: la rimessa saltava l'ordine per sempre e il negozio non veniva
  // pagato. Chi puo' toccare quale ordine lo decide `motivoPerNonRegistrare`,
  // e la stessa UPDATE lo ricontrolla (`.eq('rider_id', ...)`).
  const admin = getAdminSupabase();
  const { data: letto, error } = await admin
    .from('orders')
    .select(COLONNE_ORDINE_DA_INCASSARE)
    .eq('id', body.orderId)
    .maybeSingle();

  const order = (error ? null : letto) as OrdineDaIncassare | null;
  const chi: ChiRegistra = { chi: 'fattorino', userId: user.id };
  switch (motivoPerNonRegistrare(order, chi)) {
    case 'NON_TROVATO': return ApiErrors.notFound('Ordine non trovato');
    case 'DI_UN_ALTRO_FATTORINO': return ApiErrors.forbidden('Non autorizzato (ordine di altro rider)');
    case 'NON_IN_CONTANTI': return ApiErrors.conflict('Ordine non in cash on delivery');
    case 'GIA_CONFERMATO': return ApiErrors.conflict("Incasso gia' confermato");
    default: break;
  }
  if (!order || !order.rider_id) return ApiErrors.notFound('Ordine non trovato');

  // 155 — IL FATTORINO NON LAVORAVA GRATIS PER SBAGLIO: PER COSTRUZIONE.
  //
  // Sul contrassegno gli si chiedeva di rimettere TUTTO il contante, fee di
  // consegna compresa. E l'unica funzione che paga un fattorino esce subito
  // con «COD: il rider incassa i contanti»: nessun bonifico partiva mai.
  // Risultato: su ogni consegna pagata in contanti — il metodo naturale del
  // cliente anziano di Piacenza — il fattorino consegnava e non prendeva
  // niente. Alla prima settimana i fattorini smettono di prendere quegli
  // ordini e la consegna si ferma.
  //
  // La strada scelta e' la piu' semplice e la piu' onesta: il compenso se lo
  // tiene dal contante che ha in mano, e rimette il resto. Nessun bonifico da
  // fare, nessun saldo piattaforma da anticipare. L'atteso scende di
  // conseguenza, qui e nella quadratura di fine giornata.
  //
  // 30/8/2026 (R120) — E IL CONTANTE DA CUI TENERSELO NON C'E' SEMPRE.
  //
  // `total_price` e' il totale DOPO lo scomputo del credito MyCity, e in cassa
  // la spunta «usa il credito» e' accesa di default. Con 50 € di credito e un
  // ordine da 22 € in contrassegno l'ordine nasce a zero: il fattorino
  // consegna, non gli mette in mano niente nessuno, e non ha da cosa
  // trattenersi i suoi 3 €. I campi che lo dicono li scrive `campiDellIncasso`,
  // la stessa funzione che usa l'amministratore quando registra al suo posto.
  const expectedCents = contanteDaRimettereCents(order);

  // Cap difensivo: rifiuta importi palesemente fuori range (errore di battitura/abuso).
  if (importoFuoriMisura(order, body.cashCollectedCents)) {
    return ApiErrors.invalidRequest('Importo incassato fuori range rispetto al totale ordine.');
  }
  // Prova sopra soglia (anti-frode + dispute "non ho pagato/ricevuto"): la foto
  // dei contanti o la firma — oppure, se la foto non si puo' fare, una nota sul
  // perche', che arriva agli amministratori qui sotto. Mai un vicolo cieco: dal
  // lotto R33 un incasso rifiutato e' una consegna che non si chiude.
  const prova = valutaProvaIncasso(expectedCents, {
    foto: body.photoUrl,
    firma: body.signatureUrl,
    nota: body.nota,
  });
  if (!prova.ok) return ApiErrors.invalidRequest(prova.messaggio);

  const now = new Date();
  // 189 — La giornata di cassa del fattorino è quella di Piacenza. Con
  // `toISOString()` era quella di Greenwich: d'estate le consegne fra le 22 e
  // mezzanotte finivano nel giorno dopo, e la quadratura risultava sbagliata
  // proprio nelle sere più cariche.
  //
  // R33 — E la giornata e' quella della CONSEGNA, quando la consegna c'e' gia'.
  // Un incasso dichiarato tre giorni dopo appartiene alla sera in cui il
  // fattorino ha avuto i contanti in mano: e' quella la riga che la rimessa
  // guarda (`confirm_cod_remittance` cerca per giorno di consegna).
  const giornoDiCassa = giornoLocale(order.delivered_at ? new Date(order.delivered_at) : now);

  // Guard atomico contro la "doppia cassa": solo il PRIMO writer (con
  // cash_confirmed_at ancora NULL) vince. Il controllo qui sopra è solo un
  // fast-path: NON è atomico (TOCTOU tra la lettura e la scrittura). La
  // condizione `.is('cash_confirmed_at', null)` dentro `scriviIncasso` sposta la
  // guardia nel DB — il row-lock di Postgres serializza due conferme
  // concorrenti e la seconda non matcha più (0 righe), così non può
  // sovrascrivere cash_collected_cents/le prove. Stesso pattern del claim
  // payout in lib/stripe/payout.ts.
  //
  // 056/172 — e nella stessa UPDATE sta la guardia sullo stato di consegna
  // (PICKED_UP/OUT_FOR_DELIVERY/DELIVERED): un fattorino non puo' marcare
  // PAGATO un ordine appena assegnato, mai ritirato e mai consegnato.
  const { data: claimed, error: updErr } = await scriviIncasso(
    admin,
    { id: order.id, rider_id: order.rider_id, payment_status: order.payment_status },
    campiDellIncasso(order, {
      incassatoCents: body.cashCollectedCents,
      fotoContanti: body.photoUrl,
      firma: body.signatureUrl,
      fotoConsegna: body.deliveryPhotoUrl,
      registratoDa: user.id,
      adesso: now,
    }),
    chi,
  );

  if (updErr) return ApiErrors.internal('Update fallito');
  if (!claimed || claimed.length === 0) {
    // Un'altra conferma concorrente ha già vinto la corsa.
    return ApiErrors.conflict("Incasso gia' confermato");
  }

  // Aggiorna riconciliazione giornaliera (include i COD consegnati ma NON confermati).
  await aggiornaQuadratura(admin, user.id, giornoDiCassa);

  // 16/10/2026 — Sopra soglia senza foto: l'incasso passa, ma non in silenzio.
  // La nota resta nel registro delle attivita' (legato all'ordine) e arriva agli
  // amministratori fra gli avvisi di servizio, quelli che non si spengono.
  if (prova.senzaFoto) {
    await tracciaIncassoSenzaFoto({
      fattorinoId: user.id,
      ordineId: order.id,
      nota: prova.nota,
      incassatoCents: body.cashCollectedCents,
      attesoCents: expectedCents,
    });
    const { data: amministratori } = await admin.from('profiles').select('id').eq('role', 'admin');
    const avvisi = (amministratori ?? []).map((a) => ({
      user_id: a.id,
      category: 'system',
      title: '📷 Incasso senza foto',
      body: `Rider ${user.id.slice(0, 8)} · ordine ${body.orderId.slice(0, 8)}: dichiarati ${formatPriceFromCents(body.cashCollectedCents)} senza foto dei contanti. Motivo: «${prova.nota}»`,
      link: '/admin/orders',
    }));
    if (avvisi.length > 0) await admin.from('notifications').insert(avvisi);
  }

  // Mismatch → alert agli ADMIN (NON al rider, che è la parte da controllare).
  const delta = body.cashCollectedCents - expectedCents;
  if (Math.abs(delta) > MISMATCH_TOLERANCE_CENTS) {
    const { data: admins } = await admin.from('profiles').select('id').eq('role', 'admin');
    const rows = (admins ?? []).map((a) => ({
      user_id: a.id,
      /**
       * 30/8/2026 (R127) — «system», non la predefinita del database.
       *
       * Senza questo campo la riga nasceva nella categoria 'order' (migrazione
       * 115), cioe' insieme agli aggiornamenti d'ordine — i piu' rumorosi, e
       * quindi i primi che un amministratore spegne. `vuole_notifica` governa
       * l'invio della push: spegnendo quelli si smetteva di ricevere sul
       * telefono l'unico segnale automatico sul contante che manca all'appello.
       * 'system' e' la categoria degli avvisi di servizio: non si disattiva.
       */
      category: 'system',
      title: '⚠️ Incasso COD non quadra',
      body: `Rider ${user.id.slice(0, 8)} · ordine ${body.orderId.slice(0, 8)}: incassati €${(body.cashCollectedCents / 100).toFixed(2)}, attesi €${(expectedCents / 100).toFixed(2)} (Δ €${(delta / 100).toFixed(2)}).`,
      link: '/admin/orders',
    }));
    if (rows.length > 0) await admin.from('notifications').insert(rows);
  }

  return NextResponse.json({ ok: true, delta, expectedCents }, { status: 200 });
});

