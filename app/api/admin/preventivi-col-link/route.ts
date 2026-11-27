import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAdminAuth } from '@/lib/api/middleware';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { fermaInContanti } from '@/lib/agenzia/abbonamento-contanti';
import { getAdminSupabase } from '@/lib/supabase/server';
import { ApiErrors } from '@/lib/api/responses';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * I PREVENTIVI COL LINK, PER NICOLA — 24/11/2026.
 *
 * Le attività in «modalità preventivo» (Ora del Gusto) non hanno un accesso: il loro preventivo si
 * apre da un link col codice, che solo il server conosce (tabella preventivi_con_codice, migrazione
 * 708). Qui l'admin legge il link da mandare al titolare (WhatsApp o di persona), lo stato, e se
 * n8n ha già mandato la scheda del locale.
 *
 * 27/11/2026 — Nicola: la pagina del negozio si sblocca subito nella fascia scelta e paga in contanti al primo
 * servizio; «se non paga, fermalo tu». Qui vede se la pagina è sbloccata in contanti e la ferma (POST).
 */
export const GET = withAdminAuth(async () => {
  const admin = getAdminSupabase();
  const [link, schede, contanti, visite] = await Promise.all([
    admin.from('preventivi_con_codice').select('seller_id, codice, stato, fascia_scelta, creato_il, accettato_il, profiles!inner(store_name)').order('creato_il', { ascending: false }).limit(200),
    admin.from('schede_clienti').select('id_attivita, aggiornata_il').limit(1000),
    // 27/11/2026 — Gli abbonamenti in contanti in corso (migrazione 999). Senza la 999 la colonna non c'è: si va avanti senza.
    admin.from('abbonamenti_servizi').select('seller_id, fascia, stato').eq('origine', 'contanti').in('stato', ['active', 'past_due']).limit(1000),
    // 27/11/2026 — Il giorno in cui SDG passa, scelto dal titolare nel link (migrazione 999b). Letto a parte: senza
    // la 999b la colonna non c'è, e la lista dei preventivi deve aprirsi lo stesso (collaudo del 27/11).
    admin.from('preventivi_con_codice').select('seller_id, visita_il').not('visita_il', 'is', null).limit(1000),
  ]);
  if (link.error) {
    logger.error('[admin] preventivi col link non letti', { message: link.error.message });
    return ApiErrors.unavailable('Non riesco a leggere i preventivi col link. Controlla che la migrazione 708 sia applicata.');
  }
  const inContanti = new Map(((contanti.error ? [] : contanti.data ?? []) as { seller_id: string; fascia: string }[]).map((c) => [c.seller_id, c.fascia]));
  const conVisita = new Map(((visite.error ? [] : visite.data ?? []) as { seller_id: string; visita_il: string }[]).map((v) => [v.seller_id, v.visita_il]));
  const conScheda = new Map(((schede.data ?? []) as { id_attivita: string; aggiornata_il: string }[]).map((s) => [s.id_attivita, s.aggiornata_il]));
  const righe = (link.data ?? []).map((r) => {
    const riga = r as unknown as { seller_id: string; codice: string; stato: string; fascia_scelta: string | null; creato_il: string; accettato_il: string | null; profiles: { store_name: string | null } | { store_name: string | null }[] };
    const profilo = Array.isArray(riga.profiles) ? riga.profiles[0] : riga.profiles;
    return {
      sellerId: riga.seller_id,
      negozio: profilo?.store_name ?? '',
      stato: riga.stato,
      fascia: riga.fascia_scelta,
      creatoIl: riga.creato_il,
      accettatoIl: riga.accettato_il,
      link: `${env.appUrl()}/preventivo/${riga.codice}`,
      schedaRicevutaIl: conScheda.get(riga.seller_id) ?? null,
      sbloccatoInContanti: inContanti.get(riga.seller_id) ?? null,
      visitaIl: conVisita.get(riga.seller_id) ?? null,
    };
  });
  return NextResponse.json({ ok: true, data: righe }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
});

const Ferma = z.object({ sellerId: z.string().uuid('Negozio non valido.'), azione: z.literal('ferma-contanti') });

/** Ferma l'abbonamento in contanti di un negozio: la pagina torna in demo, la riga resta nello storico. */
export const POST = withAdminAuth(async ({ req, user }) => {
  let corpo: z.infer<typeof Ferma>;
  try {
    corpo = Ferma.parse(await jsonRichiesta(req, TETTO_JSON));
  } catch {
    return ApiErrors.invalidRequest('Dati non validi');
  }
  const fermate = await fermaInContanti(getAdminSupabase(), corpo.sellerId);
  if (fermate === null) return ApiErrors.unavailable('Non sono riuscito a fermarlo. Riprova fra poco.');
  logger.info('[admin] abbonamento in contanti fermato', { sellerId: corpo.sellerId, fermate, da: user.id });
  return NextResponse.json({ ok: true, data: { fermate } }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
});
