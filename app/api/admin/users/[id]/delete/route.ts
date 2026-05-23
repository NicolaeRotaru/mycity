import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

/**
 * Cancellazione di un account da parte di un admin.
 *
 * Flusso identico a /api/account/delete ma con due differenze:
 *  - Il chiamante deve essere admin (verifica via profili)
 *  - L'utente target è preso dall'URL [id], non dal token
 *  - Un admin non può eliminare se stesso (per evitare lock-out)
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const targetId = params.id;

  const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon    = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseService = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnon || !supabaseService) {
    return NextResponse.json({ error: 'Servizio non configurato.' }, { status: 503 });
  }
  if (!targetId || targetId.length < 10) {
    return NextResponse.json({ error: 'ID utente non valido.' }, { status: 400 });
  }

  // 1) Verifica chi è il chiamante via JWT
  const authHeader = req.headers.get('authorization');
  const bearer = authHeader?.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : null;
  if (!bearer) {
    return NextResponse.json({ error: 'Autenticazione richiesta.' }, { status: 401 });
  }

  const supaUser = createClient(supabaseUrl, supabaseAnon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userResp, error: userErr } = await supaUser.auth.getUser(bearer);
  const caller = userResp?.user;
  if (userErr || !caller) {
    return NextResponse.json({ error: 'Sessione non valida.' }, { status: 401 });
  }

  // 2) Verifica che il chiamante sia admin
  const admin = createClient(supabaseUrl, supabaseService, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: callerProfile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', caller.id)
    .single();
  if (callerProfile?.role !== 'admin') {
    return NextResponse.json({ error: 'Riservato agli amministratori.' }, { status: 403 });
  }

  // 3) Anti lock-out: un admin non puo' eliminare se stesso da qui
  if (caller.id === targetId) {
    return NextResponse.json(
      { error: 'Non puoi eliminare il tuo stesso account da qui. Usa Impostazioni → Elimina account.' },
      { status: 400 },
    );
  }

  // 4) Verifica che il target esista e ottieni il ruolo per audit
  const { data: targetProfile } = await admin
    .from('profiles')
    .select('id, role, full_name, store_name')
    .eq('id', targetId)
    .single();
  if (!targetProfile) {
    return NextResponse.json({ error: 'Utente non trovato.' }, { status: 404 });
  }

  // 5) Anonimizza profilo
  const { error: anonErr } = await admin
    .from('profiles')
    .update({
      full_name: '[utente eliminato]',
      phone: null,
      address: null, city: null, zip: null,
      legal_first_name: null, legal_last_name: null, legal_fiscal_code: null,
      legal_birth_date: null, legal_residence_addr: null, legal_residence_city: null,
      legal_residence_zip: null,
      business_legal_name: null, business_vat_number: null, business_address: null,
      business_city: null, business_zip: null, business_pec: null, business_sdi: null,
      billing_iban: null, billing_card_last4: null,
      store_name: null, store_phone: null, store_address: null,
      store_lat: null, store_lng: null, store_logo: null, store_media: null,
      store_description: null,
      is_approved: false,
      approval_status: 'rejected',
      role: 'buyer',
    })
    .eq('id', targetId);

  if (anonErr) {
    console.error('admin delete: anonymize failed', anonErr.code);
    return NextResponse.json({ error: 'Anonimizzazione fallita.' }, { status: 500 });
  }

  // 6) Cancella da auth.users
  const { error: delErr } = await admin.auth.admin.deleteUser(targetId);
  if (delErr) {
    console.error('admin delete: auth deletion failed', delErr.status);
    return NextResponse.json(
      { error: "Profilo anonimizzato ma cancellazione auth non riuscita." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    deleted: { id: targetId, role: targetProfile.role, name: targetProfile.store_name ?? targetProfile.full_name },
  });
}
