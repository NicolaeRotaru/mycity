// GET /api/agente/stato?lavoro=<uuid> — a che punto è l'AD. Ogni agente vede solo le sue schede.
// Quando l'AD ha finito, la sua risposta passa dai paletti (lib/agenti/scheda.ts → pulisci) e si unisce alla
// prima scheda; se l'AD ha trovato un sito che il programma non conosceva, il programma lo misura adesso.

import { NextResponse } from 'next/server';
import { ApiErrors } from '@/lib/api/responses';
import { conAgente } from '@/lib/agenti/rotta';
import { leggiLavoro } from '@/lib/agenti/n8n';
import { pulisci, unisci, normalizza } from '@/lib/agenti/scheda';
import { confermaQuelloCheHaTrovatoLAd } from '@/lib/agenti/conferma-ad';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nessunaCache = { 'Cache-Control': 'no-store' };

export const GET = conAgente({ name: 'agente-stato', max: 400, windowMs: 60 * 60_000 }, async ({ req, email, profile }) => {
  const lavoro = new URL(req.url).searchParams.get('lavoro') ?? '';
  if (!UUID.test(lavoro)) return ApiErrors.invalidRequest('Codice del lavoro non valido.');
  const r = await leggiLavoro(lavoro);
  if (r.stato === 'sconosciuto') return ApiErrors.notFound(r.errore ?? 'Scheda non trovata.');
  // L'admin (Nicola) le vede tutte; un agente solo le sue.
  if (profile?.role !== 'admin' && r.venditore !== email) return ApiErrors.notFound('Scheda non trovata.');
  const prima = normalizza(r.prima);
  if (!prima) return ApiErrors.unavailable('La prima scheda di questo lavoro non si legge.');
  if (r.stato === 'in_corso') return NextResponse.json({ ok: true, data: { stato: 'in_corso', scheda: prima } }, { headers: nessunaCache });
  if (r.stato === 'errore') return NextResponse.json({ ok: true, data: { stato: 'errore', errore: r.errore || 'l’AD non ha potuto fare il lavoro', scheda: prima } }, { headers: nessunaCache });
  const ad = pulisci(r.risultato);
  const scheda = unisci(prima, ad, r.avvisi ?? []);
  if (r.secondi) scheda.avvisi.unshift(`L’AD ha risposto in ${r.secondi} secondi.`);
  // 28/11/2026 — Il programma apre il sito che l'AD ha visto e le pagine dei risultati che ha visto (lib/agenti/conferma-ad.ts).
  await confermaQuelloCheHaTrovatoLAd(scheda, { sitoUrl: ad.sito?.url ?? null, pagine: ad.pagine ?? null });
  return NextResponse.json({ ok: true, data: { stato: 'pronta', scheda } }, { headers: nessunaCache });
});
