// POST /api/agente/aggiungi { lavoro } — il pulsante «Aggiungi attività» della pagina dell'agente (27/11/2026).
//
// Nicola: il preventivo nasce solo quando il titolare dice «sì, voglio aderire», e va fatto «con un clic
// dalla stessa pagina». L'agente ha la scheda davanti, il titolare dice sì, l'agente preme il pulsante:
//  1. si rilegge la scheda di QUEL lavoro dal server (mai i dati mandati dal browser), e solo se è sua
//     (l'admin le vede tutte, come in /api/agente/stato);
//  2. l'attività si iscrive come fa il flusso 20: nascosta, senza accesso, col suo link col codice
//     (lib/agenzia/nuova-attivita.ts). Premere due volte non crea un doppione: ridà lo stesso link;
//  3. partono gli stessi passi del modulo 12 (lib/agenzia/dopo-iscrizione.ts), e Nicola riceve l'avviso;
//  4. all'agente torna il link del preventivo da mandare al titolare. Il sito non manda niente da solo.
// Il pagamento, per ora, è in contanti (lib/agenzia/pagamento-servizi.ts).

import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { logger } from '@/lib/logger';
import { getAdminSupabase } from '@/lib/supabase/server';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';
import { conAgente } from '@/lib/agenti/rotta';
import { leggiLavoro } from '@/lib/agenti/n8n';
import { normalizza, pulisci, unisci } from '@/lib/agenti/scheda';
import { attivitaDallaScheda, linkDelPreventivo } from '@/lib/agenti/aggiungi';
import { iscriviAttivita } from '@/lib/agenzia/nuova-attivita';
import { avviaDopoLIscrizione } from '@/lib/agenzia/dopo-iscrizione';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const Richiesta = z.object({ lavoro: z.string().uuid('Codice del lavoro non valido.') });

/** Un lavoro dopo la risposta. Fuori da una richiesta (le prove) `after` non c'è: si lancia e basta. */
const dopoLaRisposta = (fn: () => Promise<void>) => {
  try {
    after(fn);
  } catch {
    void fn();
  }
};

export const POST = conAgente({ name: 'agente-aggiungi', max: 20, windowMs: 60 * 60_000 }, async ({ req, email, profile }) => {
  let corpo: unknown;
  try {
    corpo = await jsonRichiesta(req, TETTO_JSON);
  } catch (errore) {
    if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
    return ApiErrors.invalidRequest('Richiesta non leggibile');
  }
  const esito = Richiesta.safeParse(corpo);
  if (!esito.success) return ApiErrors.invalidRequest(esito.error.issues[0]?.message ?? 'Dati non validi');

  // 1. La scheda di quel lavoro, letta dal server, e solo se è dell'agente (o di Nicola).
  const r = await leggiLavoro(esito.data.lavoro);
  if (r.stato === 'sconosciuto') return ApiErrors.notFound(r.errore ?? 'Scheda non trovata.');
  if (profile?.role !== 'admin' && r.venditore !== email) return ApiErrors.notFound('Scheda non trovata.');
  const prima = normalizza(r.prima);
  if (!prima) return ApiErrors.unavailable('La scheda di questo lavoro non si legge.');
  const scheda = r.stato === 'pronta' ? unisci(prima, pulisci(r.risultato), r.avvisi ?? []) : prima;
  const attivita = attivitaDallaScheda(scheda);
  if (!attivita) return ApiErrors.invalidRequest('Nella scheda manca il nome dell’attività: non posso aggiungerla.');

  // 2. L'iscrizione, come il flusso 20.
  const admin = getAdminSupabase();
  const fatto = await iscriviAttivita(admin, attivita);
  if (!fatto.ok) {
    if (fatto.motivo === 'gia-con-accesso') return ApiErrors.conflict('Questa attività ha già accettato il preventivo: è già su MyCity.');
    logger.error('[agente-aggiungi] iscrizione non riuscita', { dettaglio: fatto.dettaglio });
    return ApiErrors.unavailable('Non sono riuscito ad aggiungere l’attività. Riprova fra poco.');
  }
  const link = await linkDelPreventivo(admin, fatto.id);
  logger.info('[agente-aggiungi] attività aggiunta', { id: fatto.id, nuova: fatto.nuova, conLink: Boolean(link) });

  // 3. Gli stessi passi del modulo 12, e l'avviso a Nicola (una volta per attività).
  avviaDopoLIscrizione(admin, fatto, attivita, { dalModulo12: false, dopo: dopoLaRisposta });
  if (fatto.nuova) {
    await notifyAdmins(
      `${attivita.nome} ha detto sì: attività aggiunta dall'agente`,
      `L'agente ${email} ha premuto «Aggiungi attività». Il negozio è su MyCity, nascosto e senza accesso, col suo preventivo. Il link lo trovi in Admin → Preventivi col link. Per ora si paga in contanti.`,
      '/admin/preventivi',
      { unaVoltaPer: `agente-aggiungi:${fatto.id}` },
    ).catch((e: unknown) => logger.warn('[agente-aggiungi] avviso a Nicola non partito', { id: fatto.id, errore: String(e) }));
  }

  // 4. Il link da mandare al titolare.
  return NextResponse.json(
    { ok: true, data: { nome: attivita.nome, nuova: fatto.nuova, link } },
    { status: fatto.nuova ? 201 : 200, headers: { 'Cache-Control': 'no-store' } },
  );
});
