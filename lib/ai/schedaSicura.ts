// lib/ai/schedaSicura.ts
import type { NextResponse } from 'next/server';
import { ApiErrors } from '@/lib/api/responses';
import { AiConfigError } from '@/lib/ai/client';
import { AiCallError, mapAiError } from '@/lib/ai/run';
import { assertSafeText, UnsafeContentError } from '@/lib/ai/moderation';

/**
 * Il filtro anti-contenuti-vietati sulla SCHEDA di un prodotto.
 *
 * 27/8/2026 (R148) — CINQUE ROTTE SU DICIANNOVE NON CI PASSAVANO.
 *
 * `lib/ai/moderation.ts` scrive la regola in cima al file: «se una rotta nuova
 * accetta testo libero o pubblica una scheda, passa di qui». Contando gli usi
 * veri, cinque rotte non passavano: migliora-prodotto, diagnosi, SEO,
 * traduzione, varianti. Tutte e cinque ricevono `body.product` dal browser con
 * il solo controllo «è un oggetto», e ne mettono nome e descrizione nel prompt.
 *
 * La peggiore era «migliora prodotto»: modello grande, ricerca sul web accesa,
 * e il risultato che torna nel form del venditore e da lì nel database. Il
 * pezzo di sistema che ci difende dal generare — col nostro nome e il nostro
 * conto — contenuti vietati aveva cinque porte aperte, e quale fosse aperta
 * dipendeva da quale pulsante premeva il venditore. In un'ispezione la
 * disparità fra rotte è peggio dell'assenza: prova che il rischio era stato
 * riconosciuto.
 *
 * Il controllo di stringa vuota sta PRIMA della chiamata (R152): `assertSafeText`
 * è a sua volta una chiamata a pagamento, e su una scheda senza testo non c'è
 * niente da controllare.
 */

/** Il testo scritto da una persona dentro una scheda prodotto. */
export function testoLiberoDellaScheda(product: unknown): string {
  if (!product || typeof product !== 'object') return '';
  const p = product as Record<string, unknown>;
  const tags = Array.isArray(p.tags) ? p.tags : [];
  const pezzi = [p.name, p.description, p.subcategory_name, ...tags].filter(
    (v): v is string => typeof v === 'string' && v.trim().length > 0,
  );
  // Stesso tetto che `buildProductContext` applica alla scheda che va al
  // modello: se il filtro vedesse meno di quello che legge il modello, non
  // starebbe più controllando ciò che esce.
  return pezzi.join('\n').slice(0, 4000);
}

/**
 * Passa la scheda dal filtro. Restituisce la risposta da dare al venditore se
 * il contenuto non si può usare (o se il filtro stesso è caduto), `null` se la
 * rotta può proseguire.
 */
export async function filtroSullaScheda(
  product: unknown,
  feature: string,
): Promise<NextResponse | null> {
  const testo = testoLiberoDellaScheda(product);
  if (!testo) return null;
  try {
    await assertSafeText(testo, feature);
    return null;
  } catch (err) {
    if (err instanceof UnsafeContentError) {
      return ApiErrors.invalidRequest(`Questo testo non si puo' usare: ${err.verdict.reason}`);
    }
    // Il filtro è una chiamata al modello come le altre: se cade, la risposta
    // dev'essere leggibile, non un 500 muto che arriva al browser.
    if (err instanceof AiConfigError) return ApiErrors.unavailable('Servizio AI non configurato.');
    if (err instanceof AiCallError) return mapAiError(err, feature);
    return ApiErrors.internal('Errore AI.');
  }
}
