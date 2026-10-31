import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { getAdminSupabase } from '@/lib/supabase/server';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { logger } from '@/lib/logger';
import { controlloEta } from '@/lib/maggiore-eta';
import { ABBONAMENTO_NEGOZI_ACCESO } from '@/lib/funzioni-al-lancio';

export const runtime = 'nodejs';

/**
 * LA RICHIESTA DI DIVENTARE NEGOZIO — scritta dal server, non dal browser.
 *
 * 31/10/2026 (ondata 4) — UN CLIENTE CHE CHIEDEVA DI VENDERE VENIVA RESPINTO
 * DAL DATABASE DOPO AVER COMPILATO TUTTO IL MODULO. La pagina /sell scriveva il
 * profilo dal browser con `role: 'seller'` dentro. La guardia sui profili
 * (migrazione 119) lascia cambiare a una persona solo le colonne di un elenco,
 * e `role` giustamente non c'è: chi può darsi un ruolo da solo può darsi anche
 * quello di amministratore. Risultato: chi si era iscritto come cliente e poi
 * voleva aprire un negozio riceveva «Non hai i permessi per questa azione» e
 * la richiesta non arrivava mai.
 *
 * Aprire `role` nella guardia sarebbe stato il cerotto sbagliato. Il ruolo lo
 * cambia il server, con la chiave di servizio, dopo aver deciso lui chi può
 * chiederlo:
 *  · un cliente (o un negozio già iscritto) che manda la richiesta → sì;
 *  · un negozio SOSPESO → no: la sospensione la toglie lo staff, non un modulo
 *    rimandato (prima tornava «in attesa» e rientrava nella coda come nuovo);
 *  · un negozio già approvato → no: rimandare il modulo lo riporterebbe in
 *    attesa e gli spegnerebbe la vetrina;
 *  · un fattorino o un amministratore → no: perderebbero il loro ruolo.
 *
 * Il controllo si rifà dentro la scrittura stessa (filtri su ruolo e stato):
 * se lo staff sospende il negozio fra la lettura e la scrittura, la scrittura
 * non tocca niente e la risposta lo dice.
 */

const RUOLI_CHE_POSSONO_CHIEDERE = ['buyer', 'seller'] as const;
const STATI_CHE_POSSONO_CHIEDERE = ['pending', 'rejected'] as const;

/**
 * Partita IVA italiana: 11 cifre, l'ultima è il carattere di controllo. Il
 * controllo prende gli errori di battitura, che sono quasi tutti quelli veri.
 */
function partitaIvaValida(piva: string): boolean {
  if (!/^[0-9]{11}$/.test(piva)) return false;
  let somma = 0;
  for (let i = 0; i < 10; i++) {
    let c = Number(piva[i]);
    if (i % 2 === 1) {
      c *= 2;
      if (c > 9) c -= 9;
    }
    somma += c;
  }
  return (10 - (somma % 10)) % 10 === Number(piva[10]);
}

const normalizzaPiva = (v: string) => v.replace(/\s+/g, '').toUpperCase().replace(/^IT/, '');

const vero = (messaggio: string) => z.boolean().refine((v) => v === true, { message: messaggio });

const RichiestaNegozio = z.object({
  contactPhone: z.string().trim().regex(/^[0-9 +]{8,16}$/, 'Numero di telefono non valido'),
  legalFirstName: z.string().trim().min(2, 'Inserisci il nome'),
  legalLastName: z.string().trim().min(2, 'Inserisci il cognome'),
  legalFiscalCode: z.string().trim().regex(/^[A-Z0-9]{11,16}$/i, 'Codice fiscale non valido'),
  legalBirthDate: z.string().min(1, 'Inserisci la data di nascita'),
  legalResidenceAddr: z.string().trim().min(3, 'Inserisci la via di residenza'),
  legalResidenceCity: z.string().trim().min(2, 'Inserisci la città'),
  legalResidenceZip: z.string().trim().regex(/^[0-9]{5}$/, 'CAP non valido'),
  businessLegalName: z.string().trim().min(2, 'Inserisci la ragione sociale'),
  businessVatNumber: z
    .string()
    .transform(normalizzaPiva)
    .refine(partitaIvaValida, { message: 'Partita IVA non valida: controlla le 11 cifre' }),
  businessAddress: z.string().trim().min(3, 'Inserisci la via della sede legale'),
  businessCity: z.string().trim().min(2, 'Inserisci la città della sede legale'),
  businessZip: z.string().trim().regex(/^[0-9]{5}$/, 'CAP della sede legale non valido'),
  storeName: z.string().trim().min(3, 'Nome del negozio (almeno 3 caratteri)').max(80, 'Nome del negozio (al massimo 80 caratteri)'),
  storeDescription: z.string().max(500).optional().nullable(),
  storeLogo: z.string().url().nullable().optional(),
  storeMedia: z.array(z.unknown()).max(20).optional(),
  storeAddress: z.string().trim().min(3, "Inserisci l'indirizzo del negozio"),
  storeLat: z.number().finite(),
  storeLng: z.number().finite(),
  billingIban: z.string().regex(/^[A-Z0-9]{15,34}$/i, 'IBAN non valido').optional().or(z.literal('')).nullable(),
  acceptTos: vero('Devi accettare i Termini di servizio'),
  acceptPrivacy: vero('Devi accettare la Privacy policy'),
  acceptAccuracy: vero('Devi confermare i dati'),
  // Con l'abbonamento spento non si fa accettare nessun addebito.
  acceptBilling: ABBONAMENTO_NEGOZI_ACCESO ? vero("Devi accettare l'addebito") : z.boolean().optional(),
});

export const POST = withAuthRateLimit(
  { name: 'seller-apply', max: 10, windowMs: 60_000 },
  async ({ user, req }) => {
    // Il corpo si legge col tetto, come in ogni rotta (tests/unit/nessun-corpo-senza-tetto.test.ts):
    // un modulo da centinaia di megabyte non si carica in memoria prima di guardarlo.
    let corpo: unknown;
    try {
      corpo = await jsonRichiesta(req, TETTO_JSON);
    } catch (errore) {
      if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
      return ApiErrors.invalidRequest('Richiesta non leggibile');
    }
    const esito = RichiestaNegozio.safeParse(corpo);
    if (!esito.success) {
      return ApiErrors.invalidRequest(esito.error.issues[0]?.message ?? 'Dati non validi');
    }
    const f = esito.data;

    const eta = controlloEta(f.legalBirthDate);
    if (!eta.ok) return ApiErrors.invalidRequest(eta.messaggio ?? 'Controlla la data di nascita.');

    const admin = getAdminSupabase();
    const { data: attuale, error: errLettura } = await admin
      .from('profiles')
      .select('role, approval_status')
      .eq('id', user.id)
      .maybeSingle();
    if (errLettura) {
      logger.error('[seller-apply] profilo non leggibile', { userId: user.id, message: errLettura.message });
      return ApiErrors.internal('Non è stato possibile inviare la richiesta');
    }
    if (!attuale) return ApiErrors.notFound('Profilo non trovato');

    if (attuale.approval_status === 'suspended') {
      return ApiErrors.forbidden(
        "Il tuo negozio è sospeso: per riattivarlo scrivi all'assistenza, non serve rimandare la richiesta.",
      );
    }
    if (attuale.role === 'seller' && attuale.approval_status === 'approved') {
      return ApiErrors.conflict('Il tuo negozio è già approvato.');
    }
    if (!(RUOLI_CHE_POSSONO_CHIEDERE as readonly string[]).includes(String(attuale.role))) {
      return ApiErrors.conflict(
        "Questo account ha già un altro ruolo: per aprire un negozio usa un account diverso o scrivi all'assistenza.",
      );
    }

    const adesso = new Date().toISOString();
    const { data: scritti, error } = await admin
      .from('profiles')
      .update({
        phone: f.contactPhone,
        legal_first_name: f.legalFirstName,
        legal_last_name: f.legalLastName,
        legal_fiscal_code: f.legalFiscalCode.toUpperCase(),
        legal_birth_date: f.legalBirthDate,
        legal_residence_addr: f.legalResidenceAddr,
        legal_residence_city: f.legalResidenceCity,
        legal_residence_zip: f.legalResidenceZip,
        // I dati dell'impresa: sono quelli che «Venduto da» mostra al cliente
        // e che l'amministratore controlla prima di approvare.
        business_legal_name: f.businessLegalName,
        business_vat_number: f.businessVatNumber,
        business_address: f.businessAddress,
        business_city: f.businessCity,
        business_zip: f.businessZip,
        store_name: f.storeName,
        store_phone: f.contactPhone,
        store_description: f.storeDescription || null,
        store_logo: f.storeLogo ?? null,
        store_media: f.storeMedia ?? [],
        store_address: f.storeAddress,
        store_lat: f.storeLat,
        store_lng: f.storeLng,
        billing_iban: f.billingIban ? f.billingIban.toUpperCase() : null,
        role: 'seller',
        is_approved: false,
        approval_status: 'pending',
        approval_requested_at: adesso,
        tos_accepted_at: adesso,
        privacy_accepted_at: adesso,
        data_accuracy_confirmed_at: adesso,
      })
      .eq('id', user.id)
      .in('role', [...RUOLI_CHE_POSSONO_CHIEDERE])
      // NULL = profilo vecchio che non ha mai chiesto niente: può chiedere.
      .or(`approval_status.is.null,approval_status.in.(${STATI_CHE_POSSONO_CHIEDERE.join(',')})`)
      .select('id');

    if (error) {
      logger.error('[seller-apply] richiesta non salvata', { userId: user.id, code: error.code, message: error.message });
      return ApiErrors.internal('Non è stato possibile inviare la richiesta');
    }
    if (!scritti || scritti.length === 0) {
      // Lo stato è cambiato fra la lettura e la scrittura (es. sospeso dallo staff).
      return ApiErrors.conflict('Lo stato del tuo account è appena cambiato: ricarica la pagina.');
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  },
);
