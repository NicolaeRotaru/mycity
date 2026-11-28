// /api/sdg/ordini — gli ordini di servizio arrivati a SDG Agenzia (27/11/2026, migrazione 999c).
//
// Nicola, 27/11 17:25: quando il titolare conferma l'abbonamento, «in automatico deve arrivare l'ordine del servizio,
// quindi nella pagina venditore di SDG … con su scritto tutti i dati … e tutto il piano editoriale già fatto».
// L'ordine nasce in lib/agenzia/ordine-sdg.ts. Qui lo legge la pagina /seller/ordini-sdg.
//
// CHI ENTRA: l'admin (Nicola, oggi l'unico che apre questa pagina) e l'account di SDG Agenzia (SDG_SELLER_ID), il
// giorno che avrà un accesso vero: oggi è un utente di sistema che non entra mai, e dargli un accesso è una scelta di
// Nicola. Nessun altro: né i negozi, né il titolare, né gli agenti. La tabella ha la stessa regola (RLS della 999c).
//
// GET: gli ultimi 100 ordini. Prima di rispondere guarda se è tornato il piano completo degli ordini che lo
//      aspettano (al massimo 5 per volta: ogni lettura chiede a n8n).
// POST { id, azione: 'chiedi-piano' }: richiede all'AD il piano completo di un ordine rimasto «da collegare» o andato
//      in errore. Ogni richiesta è una corsa della routine «Chiedi all'AD» (40 al giorno, insieme agli altri flussi).
// 28/11/2026 (migrazione 999h) — Lo stesso per la bozza del sito e l'analisi all'avvio: GET guarda anche se sono
//      tornate, POST accetta 'chiedi-sito' e 'chiedi-analisi'. Prima della 999h la pagina mostra il piano come oggi e
//      i due pezzi dicono «manca la migrazione 999h».

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth, withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { logger } from '@/lib/logger';
import { getAdminSupabase } from '@/lib/supabase/server';
import { COLONNE_ORDINE, aggiornaPianoCompleto, chiediIlPianoCompleto, fraseVisita, puoLeggereGliOrdiniSdg, riapriIlPianoCompleto, type OrdineSdg } from '@/lib/agenzia/ordine-sdg';
import { COLONNE_PEZZI, PEZZI_ORDINE, PEZZI_PRIMA_DELLA_999H, aggiornaIlPezzo, chiediIlPezzo, riapriIlPezzo, type ColonnePezzi, type PezzoOrdine } from '@/lib/agenzia/pezzi-dell-ordine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const nessunaCache = { 'Cache-Control': 'no-store' };
const QUANTI_PIANI_PER_VOLTA = 5;

export const GET = withAuth(async ({ user, profile }) => {
  if (!puoLeggereGliOrdiniSdg(user.id, profile?.role)) return ApiErrors.forbidden('Questa pagina è solo per SDG Agenzia.');
  const admin = getAdminSupabase();
  type Ordine = OrdineSdg & ColonnePezzi;
  let letti: { data: unknown; error: { message: string } | null } = await admin.from('ordini_sdg').select(`${COLONNE_ORDINE}, ${COLONNE_PEZZI}`).order('creato_il', { ascending: false }).limit(100);
  let senza999h = false;
  if (letti.error && /column|does not exist/i.test(letti.error.message)) {
    // Prima della 999h: gli ordini come oggi, col piano; sito e analisi «manca la migrazione 999h».
    senza999h = true;
    letti = await admin.from('ordini_sdg').select(COLONNE_ORDINE).order('creato_il', { ascending: false }).limit(100);
  }
  if (letti.error) {
    logger.error('[sdg-ordini] ordini non letti', { message: letti.error.message });
    return ApiErrors.unavailable('Non riesco a leggere gli ordini di SDG. Controlla che la migrazione 999c sia applicata.');
  }
  let ordini = ((letti.data ?? []) as unknown as Ordine[]).map((o) => (senza999h ? { ...o, ...PEZZI_PRIMA_DELLA_999H } : o));
  const inAttesa = (o: Ordine) => o.piano_completo_stato === 'in_corso' || o.sito_stato === 'in_corso' || o.analisi_stato === 'in_corso';
  const daGuardare = new Set(ordini.filter(inAttesa).slice(0, QUANTI_PIANI_PER_VOLTA).map((o) => o.id));
  if (daGuardare.size) {
    // Uno dopo l'altro sullo stesso ordine: ognuno parte dall'ordine già aggiornato dal precedente.
    const aggiorna = async (o: Ordine): Promise<Ordine> => {
      let x = (await aggiornaPianoCompleto(admin, o)) as Ordine;
      for (const pezzo of PEZZI_ORDINE) x = await aggiornaIlPezzo(admin, x, pezzo);
      return x;
    };
    const aggiornati = await Promise.all(ordini.filter((o) => daGuardare.has(o.id)).map(aggiorna));
    const perId = new Map(aggiornati.map((o) => [o.id, o]));
    ordini = ordini.map((o) => perId.get(o.id) ?? o);
  }
  return NextResponse.json({ ok: true, data: ordini.map((o) => ({ ...o, visita: fraseVisita(o.visita_il) })) }, { headers: nessunaCache });
});

const Richiesta = z.object({ id: z.string().uuid('Ordine non valido.'), azione: z.enum(['chiedi-piano', 'chiedi-sito', 'chiedi-analisi']) });
const PEZZO_DELL_AZIONE: Record<string, PezzoOrdine> = { 'chiedi-sito': 'sito', 'chiedi-analisi': 'analisi' };
const NOME_DEL_LAVORO: Record<string, string> = { 'chiedi-piano': 'Il piano completo', 'chiedi-sito': 'La bozza del sito', 'chiedi-analisi': 'L’analisi all’avvio' };

export const POST = withAuthRateLimit({ name: 'sdg-ordini-piano', max: 20, windowMs: 60 * 60_000 }, async ({ req, user, profile }) => {
  if (!puoLeggereGliOrdiniSdg(user.id, profile?.role)) return ApiErrors.forbidden('Questa pagina è solo per SDG Agenzia.');
  let corpo: unknown;
  try {
    corpo = await jsonRichiesta(req, TETTO_JSON);
  } catch (errore) {
    if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
    return ApiErrors.invalidRequest('Richiesta non leggibile');
  }
  const esito = Richiesta.safeParse(corpo);
  if (!esito.success) return ApiErrors.invalidRequest(esito.error.issues[0]?.message ?? 'Dati non validi');
  const admin = getAdminSupabase();
  const { id, azione } = esito.data;
  const pezzo = PEZZO_DELL_AZIONE[azione];
  // Un lavoro andato storto torna «da collegare»; uno pronto o in corso non si tocca (lo dice la richiesta stessa).
  let chiesto: { esito: string; dettaglio?: string };
  if (pezzo) {
    await riapriIlPezzo(admin, id, pezzo);
    chiesto = await chiediIlPezzo(id, pezzo);
  } else {
    await riapriIlPianoCompleto(admin, id);
    chiesto = await chiediIlPianoCompleto(id);
  }
  const nome = NOME_DEL_LAVORO[azione];
  if (chiesto.esito === 'chiesto') return NextResponse.json({ ok: true, data: { esito: 'chiesto' } }, { headers: nessunaCache });
  if (chiesto.esito === 'non-serve') return ApiErrors.conflict(`Per questo ordine, ${nome.charAt(0).toLowerCase()}${nome.slice(1)} c’è già o è in preparazione.`);
  if (chiesto.esito === 'non-partito') return ApiErrors.unavailable(`L’AD non è partito: ${chiesto.dettaglio ?? 'n8n non risponde'}. Riprova più tardi.`);
  if (chiesto.dettaglio === 'manca la migrazione 999h') return ApiErrors.unavailable(`${nome} si potrà chiedere dopo la migrazione 999h.`);
  logger.error('[sdg-ordini] lavoro non chiesto', { id, azione, dettaglio: chiesto.dettaglio });
  return ApiErrors.unavailable(`Non sono riuscito a chiederlo all’AD. Riprova fra poco.`);
});
