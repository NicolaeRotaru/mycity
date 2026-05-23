import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

/**
 * Cancellazione DEFINITIVA dell'account corrente.
 *
 * Cosa fa:
 *  1) Anonimizza il profilo (rimuove PII ma lascia la riga per non rompere
 *     le foreign key di ordini storici — richiesto da obblighi fiscali)
 *  2) Cancella l'utente da auth.users via Supabase Admin API
 *     (richiede SUPABASE_SERVICE_ROLE_KEY, server-only)
 *  3) Dopo la cancellazione le sessioni esistenti diventano invalide
 *
 * Sicurezza:
 *  - Richiede Authorization: Bearer <jwt> dell'utente che si vuole eliminare
 *  - Il JWT viene verificato lato server tramite Supabase
 *  - Non accetta userId da body: usa SEMPRE l'id derivato dal token
 */
export async function POST(req: NextRequest) {
  const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon    = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseService = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnon || !supabaseService) {
    return NextResponse.json(
      { error: 'Servizio non configurato. Contatta il supporto.' },
      { status: 503 },
    );
  }

  const authHeader = req.headers.get('authorization');
  const bearer = authHeader?.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : null;
  if (!bearer) {
    return NextResponse.json({ error: 'Autenticazione richiesta.' }, { status: 401 });
  }

  // 1) Verifica chi è l'utente (anon key + JWT utente)
  const supaUser = createClient(supabaseUrl, supabaseAnon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userResp, error: userErr } = await supaUser.auth.getUser(bearer);
  const user = userResp?.user;
  if (userErr || !user) {
    return NextResponse.json({ error: 'Sessione non valida.' }, { status: 401 });
  }

  // 2) Client admin (service role) per anonimizzare profilo + cancellare auth user
  const admin = createClient(supabaseUrl, supabaseService, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Anonimizzazione: rimuove PII ma lascia la riga (per foreign key sugli
  // ordini storici, conservati per obblighi fiscali).
  const { error: anonErr } = await admin
    .from('profiles')
    .update({
      full_name: '[utente eliminato]',
      phone: null,
      address: null,
      city: null,
      zip: null,
      // KYC venditori
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
      // Vetrina
      store_name: null,
      store_phone: null,
      store_address: null,
      store_lat: null,
      store_lng: null,
      store_logo: null,
      store_media: null,
      store_description: null,
      // Stato
      is_approved: false,
      approval_status: 'rejected',
      role: 'buyer',
    })
    .eq('id', user.id);

  if (anonErr) {
    console.error('account delete: anonymize failed', anonErr.code);
    return NextResponse.json({ error: 'Impossibile anonimizzare il profilo.' }, { status: 500 });
  }

  // Cancellazione vera dall'auth — l'utente non potrà più fare login
  const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
  if (delErr) {
    console.error('account delete: auth deletion failed', delErr.status);
    return NextResponse.json(
      { error: "Profilo anonimizzato ma cancellazione dell'account non riuscita. Contatta il supporto." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
