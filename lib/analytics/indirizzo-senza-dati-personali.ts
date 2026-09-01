/**
 * 27/8/2026 (R161) — QUELLO CHE LA GENTE SCRIVE NELLA RICERCA USCIVA IN CHIARO
 * DA TRE PORTE SU QUATTRO.
 *
 * Il 22/8 il testo cercato era stato ripulito dentro `trackSearchPerformed`.
 * Ma la ricerca non viaggia solo dentro quell'evento: finisce nell'indirizzo
 * della pagina — `/search?q=…` — e l'indirizzo lo mandano in giro tutte le
 * altre porte. Il beacon delle visite lo scrive nella nostra tabella insieme a
 * un riassunto che lo ricopia parola per parola; il registratore degli errori
 * allega l'indirizzo della pagina dov'è scoppiato il guasto.
 *
 * Nella casella di ricerca la gente non scrive «pane». Scrive il proprio
 * indirizzo email, il numero d'ordine, il telefono, il nome di un'altra
 * persona. Una pulizia che copre un quarto della superficie non è una
 * pulizia: è una cosa in cui si crede.
 *
 * La regola, una sola per tutti: della strada si tiene tutto (serve per sapere
 * quali pagine si visitano), dei parametri si tiene il NOME e si nasconde il
 * VALORE — tranne le etichette di campagna, che dicono da dove arriva la gente
 * e non chi è. Il pezzo dopo il cancelletto sparisce del tutto: è lì che
 * Supabase mette i gettoni di accesso.
 *
 * Il testo cercato non si perde: continua ad arrivare, già ripulito, dentro
 * l'evento `search_performed`. Qui non serve una seconda copia.
 */

/**
 * Le uniche chiavi di cui teniamo anche il valore: dicono da quale campagna o
 * da quale pagina di elenco arriva la visita, e nessuna di loro è compilata
 * dalla persona.
 */
const CHIAVI_INNOCUE = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'page',
  'pagina',
  'sort',
  'ordina',
  'tab',
  'view',
  'vista',
]);

/** Quello che prende il posto di un valore che potrebbe essere di una persona. */
export const VALORE_NASCOSTO = '***';

/** Il campo `path` di `activity_events` è lungo così: oltre non ci sta. */
const LUNGHEZZA_MASSIMA = 500;

/** Base finta: serve solo a far digerire un percorso relativo a `new URL`. */
const BASE_FINTA = 'http://indirizzo.interno';

/**
 * Ripulisce un indirizzo — relativo (`/search?q=…`) o intero
 * (`https://google.com/search?q=…`) — da tutto ciò che una persona può avervi
 * scritto dentro.
 *
 * Torna `null` quando non c'è un indirizzo utilizzabile: meglio una colonna
 * vuota che una riga finta.
 */
export function indirizzoSenzaDatiPersonali(grezzo: unknown): string | null {
  if (typeof grezzo !== 'string') return null;
  const testo = grezzo.trim();
  if (!testo) return null;
  // Un indirizzo più lungo di così non arriva da una navigazione vera.
  if (testo.length > 4000) return null;

  const schema = /^([a-z][a-z0-9+.-]*):/i.exec(testo)?.[1]?.toLowerCase() ?? null;
  // `javascript:`, `data:`, `mailto:` e compagnia non sono pagine viste.
  if (schema && schema !== 'http' && schema !== 'https') return null;

  let url: URL;
  try {
    url = new URL(testo, BASE_FINTA);
  } catch {
    return null;
  }

  const pezzi: string[] = [];
  for (const [chiave, valore] of url.searchParams) {
    const nome = encodeURIComponent(chiave.slice(0, 40));
    pezzi.push(
      CHIAVI_INNOCUE.has(chiave.toLowerCase())
        ? `${nome}=${encodeURIComponent(valore.slice(0, 60))}`
        : `${nome}=${VALORE_NASCOSTO}`,
    );
  }
  const domande = pezzi.length ? `?${pezzi.join('&')}` : '';

  // L'origine si tiene solo se c'era davvero: `//altrosito.it/x` arriva qui
  // come se fosse relativo, e di quello teniamo solo la strada.
  const origine = schema ? url.origin : '';
  return (origine + url.pathname + domande).slice(0, LUNGHEZZA_MASSIMA);
}
