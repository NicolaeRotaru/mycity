import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { rateLimitAsync } from '@/lib/rate-limit';
// Piacenza e dintorni: il riquadro dove si cerca quando la città è Piacenza.
import { RIQUADRO_PIACENZA } from '@/lib/ordini/zona-di-consegna';

/**
 * Trovare le coordinate di un indirizzo, dal server.
 *
 * 22/8/2026 — PERCHE' ESISTE QUESTO FILE.
 *
 * Il browser, al checkout, geolocalizzava l'indirizzo scritto a mano e mandava
 * le coordinate al server. Il server le buttava — giustamente: il prezzo della
 * consegna dipende dalla distanza, e un numero che arriva dal browser è un
 * numero che si può cambiare. Solo che poi non le calcolava nemmeno lui:
 * l'ordine nasceva senza destinazione, la mappa della consegna restava vuota e
 * il tempo di arrivo non si poteva stimare. Il fattorino andava a naso.
 *
 * Qui il server se le calcola da sé. NON entrano nel prezzo — quello resta
 * deciso dalla consegna (che non dipende dalla distanza): servono a
 * far vedere dove va la spesa e quanto manca.
 *
 * Stessa fonte, stesse regole e stesso timeout della rotta /api/geocode: la
 * logica sta qui una volta sola.
 */
export async function coordinateDiUnIndirizzo(
  indirizzo: { address: string; city: string; zip: string } | string,
): Promise<PosizioneTrovata | null> {
  // La rotta /api/geocode passa la frase così come le arriva; il server dell'ordine i tre campi,
  // che diventano la stessa frase della cassa («via, CAP città, Italia»).
  if (typeof indirizzo === 'string') return trovaLaPosizione(indirizzo);
  const q = `${indirizzo.address}, ${indirizzo.zip} ${indirizzo.city}, Italia`.trim().slice(0, 300);
  if (q.length < 3) return null;
  return trovaLaPosizione(q);
}

/**
 * 13/11/2026 (R13-001) — VIA ROMA, IN PIENO CENTRO, FINIVA A PODENZANO.
 *
 * La domanda alle mappe era a testo libero («Via Roma 10, 29121 Piacenza, Italia»), con un
 * solo risultato e nessun confine. Nominatim prendeva «Piacenza» per la provincia e
 * rispondeva con la prima Via Roma che trovava: quella di Podenzano, a 10 km dal negozio. La
 * cassa diceva «troppo lontano» e l'ordine non partiva. Su otto vie del centro, cinque
 * finivano fuori città.
 *
 * Adesso la frase si divide nei suoi pezzi (via, CAP, città) e la domanda è strutturata;
 * se la città è Piacenza, o non è scritta, la ricerca resta dentro il riquadro di Piacenza
 * (`viewbox` + `bounded`). Si chiedono più risultati e si tiene solo quello che cade nel
 * comune scritto, col CAP scritto per primo. Se nessuno è affidabile la risposta è «non
 * so» (null): l'ordine passa senza coordinate, come il codice prevede già, invece di
 * essere fermato da un punto sbagliato. Il controllo dei 5 km resta com'è.
 *
 * La usano tutti e due gli ingressi: il server dell'ordine (contanti e carta, qui sopra) e
 * la rotta /api/geocode (la cassa che avvisa prima, la rubrica degli indirizzi, il negozio
 * che fissa la sua posizione). Stessa frase, stessa risposta.
 */

/** La città che serviamo: quella che si intende quando l'indirizzo non ne scrive una. */
const CITTA_SERVITA = 'Piacenza';

// I campi della risposta di Nominatim che dicono in che comune (o frazione) sta il punto.
// NON la provincia (`county`): la provincia di Piacenza si chiama Piacenza anche a Podenzano.
const CAMPI_DEL_COMUNE = ['city', 'town', 'village', 'municipality', 'hamlet', 'suburb'] as const;

type RisultatoNominatim = {
  lat?: string;
  lon?: string;
  display_name?: string;
  address?: Partial<Record<string, string>>;
};

/**
 * `luogo` è il nome del posto trovato, come lo scrivono le mappe («Via Roma, Piacenza, …»):
 * 13/11/2026 (R13-006) il negozio che fissa la sua posizione lo legge sotto il campo, e vede
 * subito se è finito in un'altra città.
 */
export type PosizioneTrovata = { lat: number; lng: number; luogo: string | null };

function normalizza(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** «Via Roma 10, 29121 Piacenza, Italia» → via, CAP e città. Senza città: Piacenza. */
function pezziDellaFrase(frase: string): { via: string; cap: string; citta: string } {
  const parti = frase.split(',').map((p) => p.trim()).filter(Boolean);
  // In coda: il paese e la sigla della provincia non sono la città.
  while (parti.length > 1 && /^(italia|italy|\(?[a-z]{2}\)?)$/i.test(parti[parti.length - 1])) parti.pop();
  let cap = '';
  let citta = '';
  if (parti.length > 1) {
    const ultimo = parti[parti.length - 1];
    const capScritto = ultimo.match(/\b\d{5}\b/)?.[0] ?? '';
    const resto = ultimo.replace(/\b\d{5}\b/, '').replace(/\([^)]*\)/g, '').trim();
    // «5» da solo è il numero civico di «Corso Vittorio Emanuele II, 5», non una città.
    if (capScritto || /\p{L}/u.test(resto)) {
      parti.pop();
      cap = capScritto;
      citta = resto;
    }
  }
  return { via: parti.join(', '), cap, citta: citta || CITTA_SERVITA };
}

/**
 * 13/11/2026 (R13-001, dal collaudo) — Il CAP scritto non serve solo a mettere in ordine: un
 * risultato con un CAP DIVERSO da quello scritto si scarta, come quello di un altro comune. Fuori
 * da Piacenza il riquadro non c'è, e un nome di frazione comune («Quarto», CAP 29020, a
 * Gossolengo) trovava Quarto in provincia di Napoli (CAP 80010): fuori zona, «troppo lontano».
 * Un risultato SENZA CAP vale solo se la ricerca è chiusa nel riquadro di Piacenza; fuori, con
 * un CAP scritto, il CAP deve combaciare. Nessuno affidabile: null.
 */
function scegliIlRisultato(
  risultati: RisultatoNominatim[],
  cercato: { cap: string; citta: string },
  chiusaNelRiquadro: boolean,
): PosizioneTrovata | null {
  const scritta = ` ${normalizza(cercato.citta)} `;
  const nelComuneScritto = risultati.filter((r) =>
    CAMPI_DEL_COMUNE.some((campo) => {
      const nome = normalizza(r.address?.[campo] ?? '');
      return nome.length > 0 && scritta.includes(` ${nome} `);
    }),
  );
  // Le mappe a volte scrivono più CAP per la stessa via («29121;29122»).
  const capDelRisultato = (r: RisultatoNominatim) =>
    (r.address?.postcode ?? '').split(/[;,]/).map((c) => c.trim()).filter(Boolean);
  const ordinati = cercato.cap
    ? [
        ...nelComuneScritto.filter((r) => capDelRisultato(r).includes(cercato.cap)),
        ...(chiusaNelRiquadro ? nelComuneScritto.filter((r) => capDelRisultato(r).length === 0) : []),
      ]
    : nelComuneScritto;
  for (const r of ordinati) {
    const lat = r.lat != null ? parseFloat(r.lat) : NaN;
    const lng = r.lon != null ? parseFloat(r.lon) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng, luogo: r.display_name ?? null };
  }
  return null;
}

/**
 * La città scritta è Piacenza? Anche con la sigla della provincia o un CAP storpiato
 * attaccato («Piacenza PC», «2912 Piacenza»): 13/11/2026 (R13-001, dal collaudo) prima il
 * riquadro scattava solo per «Piacenza» esatto, e la ricerca non era più chiusa sulla città.
 */
function eLaCittaServita(citta: string): boolean {
  const parole = normalizza(citta)
    .split(' ')
    .filter((p) => p && !/^\d+$/.test(p) && !/^[a-z]{2}$/.test(p));
  return parole.join(' ') === normalizza(CITTA_SERVITA);
}

/**
 * Dove sta l'indirizzo scritto in una frase, secondo le mappe. null = non si sa (non
 * trovato, nessun risultato nel comune scritto, rete giù): chi chiama non deve bloccare.
 */
async function trovaLaPosizione(frase: string): Promise<PosizioneTrovata | null> {
  const cercato = pezziDellaFrase(frase.trim().slice(0, 300));
  if (cercato.via.length < 3) return null;

  const chiusaNelRiquadro = eLaCittaServita(cercato.citta);
  const params = new URLSearchParams({
    street: cercato.via,
    city: chiusaNelRiquadro ? CITTA_SERVITA : cercato.citta,
    countrycodes: 'it',
    format: 'json',
    addressdetails: '1',
    limit: '5',
  });
  if (cercato.cap) params.set('postalcode', cercato.cap);
  if (chiusaNelRiquadro) {
    const r = RIQUADRO_PIACENZA;
    params.set('viewbox', `${r.ovest},${r.nord},${r.est},${r.sud}`);
    params.set('bounded', '1');
  }

  try {
    const chiave = `${normalizza(cercato.via)}|${normalizza(cercato.citta)}|${cercato.cap}`;
    const risultati = await chiediANominatim(chiave, params);
    return risultati ? scegliIlRisultato(risultati, cercato, chiusaNelRiquadro) : null;
  } catch {
    // Un indirizzo che non si trova non è un ordine da bloccare: si prosegue
    // senza la mappa, come si faceva prima.
    logger.warn('[geocodifica] indirizzo non risolto', { lunghezza: frase.length });
    return null;
  }
}

/**
 * 13/11/2026 (R13-010) — UN FRENO SOLO PER TUTTO IL SITO VERSO NOMINATIM.
 *
 * La regola d'uso del servizio pubblico delle mappe chiede al massimo UNA richiesta al
 * secondo per applicazione. Il solo freno era per indirizzo IP (30 al minuto, nella rotta
 * /api/geocode), e il server dell'ordine chiamava per conto suo: dieci clienti che scrivono
 * l'indirizzo insieme facevano dieci chiamate nello stesso istante, e lo stesso indirizzo
 * veniva chiesto ogni volta da capo. Un sabato di campagna e Nominatim blocca «MyCity/1.0»:
 * da lì la ricerca delle posizioni tace per tutti.
 *
 * Adesso tutte le chiamate passano di qui (la rotta e il server dell'ordine usano la stessa
 * funzione) e:
 *  ① una risposta già avuta per lo stesso indirizzo si riusa (anche mentre è ancora in
 *    arrivo), senza richiamare il servizio;
 *  ② prima di chiamare si chiede il turno al freno condiviso del sito (`rateLimitAsync`, la
 *    chiave `nominatim:globale`, uno al secondo). Con Upstash il conto è di tutto il sito;
 *    senza, ogni copia conta per sé (lib/rate-limit.ts: in produzione Upstash va messo).
 *    Se il turno non arriva entro qualche secondo la risposta è «non so» (null), come quando
 *    Nominatim è giù: nessun ordine si blocca per questo.
 *
 * La memoria vive nella copia del sito che gira, non in un deposito condiviso.
 */
const FRENO_NOMINATIM = { key: 'nominatim:globale', max: 1, windowMs: 1_000 } as const;
const ATTESA_MASSIMA_MS = 3_000;
const PASSO_ATTESA_MS = 250;
const MEMORIA_MS = 30 * 24 * 60 * 60 * 1_000;
const MEMORIA_MASSIMA = 1_000;

const memoria = new Map<string, { scade: number; risposta: Promise<RisultatoNominatim[] | null> }>();

async function aspettaIlTurno(): Promise<boolean> {
  const fine = Date.now() + ATTESA_MASSIMA_MS;
  for (;;) {
    if ((await rateLimitAsync(FRENO_NOMINATIM)).allowed) return true;
    if (Date.now() + PASSO_ATTESA_MS > fine) return false;
    await new Promise((fatto) => setTimeout(fatto, PASSO_ATTESA_MS));
  }
}

/** I risultati grezzi di Nominatim per questa domanda; null = non si sa (freno pieno, rete, errore). */
function chiediANominatim(chiave: string, params: URLSearchParams): Promise<RisultatoNominatim[] | null> {
  const ora = Date.now();
  const ricordo = memoria.get(chiave);
  if (ricordo && ricordo.scade > ora) return ricordo.risposta;

  const risposta = (async (): Promise<RisultatoNominatim[] | null> => {
    if (!(await aspettaIlTurno())) {
      logger.warn('[geocodifica] freno di Nominatim pieno: rispondo «non so»');
      return null;
    }
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: {
        // Nominatim Usage Policy: User-Agent identificativo obbligatorio.
        'User-Agent': `MyCity/1.0 (${env.appUrl()})`,
        'Accept-Language': 'it',
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    return Array.isArray(json) ? (json as RisultatoNominatim[]) : null;
  })();

  memoria.delete(chiave);
  memoria.set(chiave, { scade: ora + MEMORIA_MS, risposta });
  while (memoria.size > MEMORIA_MASSIMA) {
    const piuVecchia = memoria.keys().next().value;
    if (piuVecchia === undefined) break;
    memoria.delete(piuVecchia);
  }
  // Un «non so» (freno, rete, errore) non si ricorda: la prossima volta si riprova.
  const dimentica = () => {
    if (memoria.get(chiave)?.risposta === risposta) memoria.delete(chiave);
  };
  risposta.then((r) => { if (r === null) dimentica(); }, dimentica);
  return risposta;
}
