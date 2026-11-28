// POST /api/agente/analizza { testo } — il pulsante «Analizza» dell'agente.
// In 2-6 secondi: legge il link di Google Maps, chiede a OpenStreetMap, misura il sito (anche indovinandone
// l'indirizzo), compone la prima scheda e manda il lavoro all'AD (n8n → «Chiedi all'AD»). Risponde con la prima
// scheda e il codice del lavoro. Nessun dato di Google viene salvato: del link si legge solo l'indirizzo.

import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { conAgente } from '@/lib/agenti/rotta';
import { risolviLink, cittaDa } from '@/lib/agenti/link';
import { cercaOsm } from '@/lib/agenti/osm';
import { misuraSito, indovinaSito, sitoIndicato, NON_E_UN_SITO } from '@/lib/agenti/sito';
import { leggiCanaleDelVenditore } from '@/lib/agenti/canale-venditore';
import { primaScheda } from '@/lib/agenti/scheda';
import { COMPITO, SCHEMA, FLUSSO, datiPerAd } from '@/lib/agenti/compito';
import { avviaLavoro } from '@/lib/agenti/n8n';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const adesso = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { giorno: `${p.year}-${p.month}-${p.day}`, data: `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}` };
};

export const POST = conAgente({ name: 'agente-analizza', max: 20, windowMs: 60 * 60_000 }, async ({ req, email }) => {
  let corpo: unknown;
  try {
    corpo = await jsonRichiesta(req, TETTO_JSON);
  } catch (errore) {
    if (errore instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge(errore.message);
    return ApiErrors.invalidRequest('Richiesta non leggibile');
  }
  const testo = String((corpo as { testo?: unknown } | null)?.testo ?? '').slice(0, 2000);
  // 28/11/2026 — Facoltativo: il sito o il profilo che il venditore vede sulla scheda Google (lib/agenti/canale-venditore.ts).
  const canale = leggiCanaleDelVenditore((corpo as { canale?: unknown } | null)?.canale);
  const profili = [canale?.instagram, canale?.tiktok].filter((p): p is string => !!p);
  const letto = await risolviLink(testo);
  if (letto.errore && !letto.nome && letto.lat === null) return ApiErrors.invalidRequest(letto.errore);
  const citta = cittaDa(letto.indirizzo);
  // La mappa libera, la ricerca del sito (gli indirizzi più probabili) e il sito scritto dal venditore partono
  // insieme: 3-4 secondi in tutto. Vince il sito del venditore, se porta il nome e la città del locale.
  const [osm, indovinato, indicato] = await Promise.all([
    cercaOsm({ lat: letto.lat, lon: letto.lon, nome: letto.nome, citta, attesaMs: 3500 }),
    indovinaSito(letto.nome, citta, 3500, profili),
    canale?.sito && letto.nome ? sitoIndicato(canale.sito, letto.nome, citta) : Promise.resolve(null),
  ]);
  const nomeDallaMappa = !letto.nome ? osm.luogo?.nome ?? null : null;
  const dalVenditore = indicato ?? (canale?.sito && nomeDallaMappa ? await sitoIndicato(canale.sito, nomeDallaMappa, citta) : null);
  let misura = dalVenditore;
  const sitoNoto = osm.luogo?.sito && !NON_E_UN_SITO.test(osm.luogo.sito) ? osm.luogo.sito : null;
  if (!misura?.aperto && sitoNoto) misura = await misuraSito(sitoNoto);
  if (!misura?.aperto && indovinato) misura = indovinato;
  else if (!misura?.aperto && nomeDallaMappa) misura = (await indovinaSito(nomeDallaMappa, citta, 3500, profili)) ?? misura;
  // Il sito scritto dal venditore che non si apre o non è del locale resta nella scheda come indizio, mai come sito.
  const sitoNonConfermato = canale?.sito && !dalVenditore ? canale.sito : null;
  const { giorno, data } = adesso();
  const prima = primaScheda({ letto, osm, misura, citta, data, venditore: canale ? { canale, sitoNonConfermato } : null });
  if (letto.errore) prima.avvisi.push(letto.errore);
  const lavoro = randomUUID();
  const job = { flusso: FLUSSO, compito: COMPITO, schema: SCHEMA, dati: datiPerAd({ prima, osm, misura, giorno, venditore: canale }) };
  const partito = await avviaLavoro(lavoro, email, prima.nome, prima, job);
  if (!partito.ok) prima.avvisi.push(`L’AD non è partito: ${partito.errore}. Hai solo la prima scheda; riprova fra poco.`);
  return NextResponse.json({ ok: true, data: { lavoro: partito.ok ? lavoro : null, scheda: prima } }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
});
