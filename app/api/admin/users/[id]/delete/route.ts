import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

/**
 * Cancellazione di un account da parte di un admin.
 * Pipeline = a /api/account/delete ma:
 *  - target preso da [id] in URL (non dal token)
 *  - chiamante deve essere admin (verificato via DB)
 *  - admin non puo' cancellare se stesso da qui (anti lock-out)
 *  - errori dettagliati nel response (utile per debug, e' admin)
 */

const SAFE_FIELDS = {
  full_name: '[utente eliminato]',
  phone: null,
  address: null,
  city: null,
  zip: null,
  store_name: null,
  store_phone: null,
  store_address: null,
  store_lat: null,
  store_lng: null,
  store_logo: null,
  store_media: null,
  store_description: null,
  is_approved: false,
  role: 'buyer',
};

const KYC_FIELDS = {
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
};

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const targetId = params.id;

  const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon    = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseService = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnon) {
    return NextResponse.json({ error: 'Servizio non configurato.' }, { status: 503 });
  }
  if (!supabaseService) {
    return NextResponse.json(
      { error: 'Manca SUPABASE_SERVICE_ROLE_KEY nelle variabili d\'ambiente del server. Aggiungila in Render → Environment.' },
      { status: 503 },
    );
  }
  if (!targetId || targetId.length < 10) {
    return NextResponse.json({ error: 'ID utente non valido.' }, { status: 400 });
  }

  // 1) Verifica JWT del chiamante
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

  // 2) Verifica ruolo admin
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

  // 3) Anti lock-out
  if (caller.id === targetId) {
    return NextResponse.json(
      { error: 'Non puoi eliminare il tuo stesso account da qui. Usa Impostazioni → Elimina account.' },
      { status: 400 },
    );
  }

  // 4) Esistenza target
  const { data: targetProfile } = await admin
    .from('profiles')
    .select('id, role, full_name, store_name')
    .eq('id', targetId)
    .single();
  if (!targetProfile) {
    return NextResponse.json({ error: 'Utente non trovato.' }, { status: 404 });
  }

  // 5) Anonimizzazione resiliente
  const full = await admin.from('profiles').update({ ...SAFE_FIELDS, ...KYC_FIELDS }).eq('id', targetId);
  if (full.error) {
    console.warn('admin delete: full anonymize failed, fallback', full.error.message);
    const safe = await admin.from('profiles').update(SAFE_FIELDS).eq('id', targetId);
    if (safe.error) {
      console.error('admin delete: even safe anonymize failed', safe.error);
      // L'admin si merita il dettaglio dell'errore
      return NextResponse.json(
        { error: `Anonimizzazione fallita: ${safe.error.message}`, code: safe.error.code },
        { status: 500 },
      );
    }
  }

  // 6) Cancella da auth.users
  const { error: delErr } = await admin.auth.admin.deleteUser(targetId);
  if (delErr) {
    console.error('admin delete: auth deletion failed', delErr);
    return NextResponse.json(
      { error: `Profilo anonimizzato ma cancellazione auth fallita: ${delErr.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    deleted: { id: targetId, role: targetProfile.role, name: targetProfile.store_name ?? targetProfile.full_name },
  });
}
