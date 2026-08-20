import type { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

type Admin = ReturnType<typeof getAdminSupabase>;

/**
 * Cancellare un account: una pipeline sola, per tutte le strade.
 *
 * Il difetto (#178). Le cancellazioni erano due, scritte in due file diversi, e
 * facevano cose diverse:
 *
 *   · quella del cron (richiesta dalla persona, dopo i 30 giorni) anonimizzava
 *     il profilo, i dati di verifica identità, il testo libero, cancellava i
 *     file dallo storage e toglieva l'iscrizione alla newsletter;
 *   · quella dell'amministratore anonimizzava il profilo e basta. Carta
 *     d'identità e selfie restavano nello storage, le recensioni col nome
 *     dentro restavano, la newsletter continuava ad arrivare.
 *
 * Due strade per la stessa promessa — «i tuoi dati vengono cancellati» — e una
 * delle due non la manteneva. Chi la sceglie non lo decide la persona: dipende
 * da chi preme il pulsante.
 *
 * Ora la pipeline è questa, e la chiamano tutte e due.
 */

/** Campi di vetrina e anagrafica: si azzerano sempre. */
export const CAMPI_PROFILO_DA_AZZERARE = {
  full_name: null,
  phone: null,
  address: null,
  city: null,
  zip: null,
  avatar_url: null,
  store_name: null,
  store_address: null,
  store_phone: null,
  store_lat: null,
  store_lng: null,
  store_logo: null,
  store_media: null,
  store_description: null,
  is_approved: false,
  role: 'buyer',
} as const;

/** Dati di verifica identità e pagamento: si azzerano sempre, anche nel ripiego. */
export const CAMPI_KYC_DA_AZZERARE = {
  legal_first_name: null,
  legal_last_name: null,
  legal_fiscal_code: null,
  legal_birth_date: null,
  legal_residence_addr: null,
  legal_residence_city: null,
  legal_residence_zip: null,
  business_legal_name: null,
  business_vat_number: null,
  business_address: null,
  business_city: null,
  business_zip: null,
  business_pec: null,
  business_sdi: null,
  billing_iban: null,
  billing_card_last4: null,
  approval_status: 'rejected',
  kyc_id_doc_front_url: null,
  kyc_id_doc_back_url: null,
  kyc_selfie_url: null,
  rider_license_url: null,
  rider_insurance_url: null,
  rider_haccp_url: null,
} as const;

/** Secchi dello storage che possono contenere file personali. */
export const SECCHI_CON_FILE_PERSONALI = ['kyc-docs', 'cod-proof'] as const;

/**
 * Cancella i file dell'utente dallo storage.
 *
 * Azzerare la colonna che punta al file NON cancella il file: le carte
 * d'identità e i selfie restavano nello storage per sempre.
 */
export async function cancellaFilePersonali(
  admin: Admin,
  userId: string,
): Promise<{ rimossi: number; errori: string[] }> {
  let rimossi = 0;
  const errori: string[] = [];

  for (const secchio of SECCHI_CON_FILE_PERSONALI) {
    try {
      const { data: elenco, error } = await admin.storage.from(secchio).list(userId, { limit: 1000 });
      if (error) { errori.push(`${secchio}: ${error.message}`); continue; }
      if (!elenco || elenco.length === 0) continue;

      // Un livello di sottocartelle (per esempio cod-proof/<utente>/<ordine>/).
      const percorsi: string[] = [];
      for (const voce of elenco) {
        if (voce.id === null) {
          const { data: dentro } = await admin.storage
            .from(secchio)
            .list(`${userId}/${voce.name}`, { limit: 1000 });
          for (const f of dentro ?? []) percorsi.push(`${userId}/${voce.name}/${f.name}`);
        } else {
          percorsi.push(`${userId}/${voce.name}`);
        }
      }
      if (percorsi.length === 0) continue;

      const { error: errRimozione } = await admin.storage.from(secchio).remove(percorsi);
      if (errRimozione) errori.push(`${secchio}: ${errRimozione.message}`);
      else rimossi += percorsi.length;
    } catch (e) {
      errori.push(`${secchio}: ${e instanceof Error ? e.message : 'errore'}`);
    }
  }
  return { rimossi, errori };
}

/** Anonimizza il testo libero scritto dalla persona (recensioni, note, chat). */
export async function anonimizzaTestoLibero(admin: Admin, userId: string): Promise<void> {
  await Promise.all([
    admin.from('reviews').update({ comment: null }).eq('user_id', userId),
    admin.from('store_reviews').update({ comment: null }).eq('user_id', userId),
    admin.from('rider_reviews').update({ comment: null }).eq('user_id', userId),
    admin.from('returns').update({ notes: null }).eq('buyer_id', userId),
    admin.from('messages').update({ body: '[messaggio rimosso]' }).eq('sender_id', userId),
    admin
      .from('contact_messages')
      .update({ name: '[eliminato]', email: '[eliminato]', message: '[rimosso]' })
      .eq('user_id', userId),
  ]).catch((e) => logger.warn('[cancellazione] anonimizzazione testo libero parziale', { userId, e }));
}

/**
 * Toglie l'iscrizione alla newsletter, che vive per indirizzo email e non per
 * profilo. L'email va letta PRIMA di cancellare l'utente: dopo non esiste più.
 */
export async function togliDallaNewsletter(admin: Admin, userId: string): Promise<void> {
  try {
    const { data: utenteAuth } = await admin.auth.admin.getUserById(userId);
    const emailUtente = utenteAuth?.user?.email ?? null;
    if (!emailUtente) return;
    const { error } = await admin.from('newsletter_subscribers').delete().ilike('email', emailUtente);
    if (error) logger.warn('[cancellazione] newsletter non ripulita', { userId, err: error.message });
  } catch (e) {
    logger.warn('[cancellazione] lettura email per la newsletter fallita', { userId, e });
  }
}

/** Anonimizza il profilo: prima tutto insieme, poi in due passi se qualcosa non passa. */
export async function anonimizzaProfilo(admin: Admin, userId: string): Promise<{ ok: boolean; errore?: string }> {
  const completo = await admin
    .from('profiles')
    .update({ ...CAMPI_PROFILO_DA_AZZERARE, ...CAMPI_KYC_DA_AZZERARE })
    .eq('id', userId);
  if (!completo.error) return { ok: true };

  logger.warn('[cancellazione] anonimizzazione completa fallita, si riprova a pezzi', {
    userId, err: completo.error.message,
  });
  const base = await admin.from('profiles').update(CAMPI_PROFILO_DA_AZZERARE).eq('id', userId);
  if (base.error) return { ok: false, errore: base.error.message };

  // I dati di verifica identità non si lasciano mai in chiaro, nemmeno nel ripiego.
  const { error: errKyc } = await admin.from('profiles').update(CAMPI_KYC_DA_AZZERARE).eq('id', userId);
  if (errKyc) logger.warn('[cancellazione] dati KYC non tutti azzerati', { userId, err: errKyc.message });
  return { ok: true };
}

export type EsitoCancellazione = {
  ok: boolean;
  errore?: string;
  fileRimossi: number;
  erroriFile: string[];
};

/**
 * La cancellazione completa di un account, nell'ordine giusto.
 * I file vanno prima della cancellazione dell'utente: dopo, l'elenco delle sue
 * cartelle non è più ricostruibile.
 */
export async function cancellaAccount(admin: Admin, userId: string): Promise<EsitoCancellazione> {
  const profilo = await anonimizzaProfilo(admin, userId);
  if (!profilo.ok) {
    return { ok: false, errore: `Anonimizzazione fallita: ${profilo.errore}`, fileRimossi: 0, erroriFile: [] };
  }

  await anonimizzaTestoLibero(admin, userId);
  await togliDallaNewsletter(admin, userId);

  const file = await cancellaFilePersonali(admin, userId);
  if (file.errori.length > 0) {
    logger.warn('[cancellazione] file personali non tutti rimossi', { userId, errori: file.errori });
  }

  const { error: errAuth } = await admin.auth.admin.deleteUser(userId);
  if (errAuth) {
    return {
      ok: false,
      errore: `Profilo anonimizzato ma cancellazione dell'account fallita: ${errAuth.message}`,
      fileRimossi: file.rimossi,
      erroriFile: file.errori,
    };
  }

  return { ok: true, fileRimossi: file.rimossi, erroriFile: file.errori };
}
