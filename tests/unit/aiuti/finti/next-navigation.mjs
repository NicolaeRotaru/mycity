/** next/navigation in finto: fuori da Next questi hook lanciano, qui rispondono piano. */
/**
 * 15/10/2026 (R43) — DOVE LA PAGINA HA MANDATO LA PERSONA.
 *
 * `push` e `replace` non facevano niente, quindi nessuna prova poteva dire «dopo
 * l'accesso respinto, la pagina porta alla verifica dell'email». Se la prova
 * mette un array in `globalThis.__NAVIGAZIONI__`, ogni spostamento ci finisce
 * dentro; chi non lo mette non si accorge di niente.
 */
const annota = (tipo) => (dove) => {
  if (Array.isArray(globalThis.__NAVIGAZIONI__)) globalThis.__NAVIGAZIONI__.push({ tipo, dove: String(dove) });
};
const rotta = { push: annota('push'), replace: annota('replace'), back() {}, forward() {}, refresh() {}, prefetch() {} };

export const useRouter = () => rotta;
export const usePathname = () => globalThis.__PERCORSO_FINTO__ ?? '/';
/**
 * R10-010 (onda 2, 28/11/2026) — In Next `useSearchParams` restituisce lo STESSO oggetto finché
 * l'indirizzo non cambia. Il finto ne creava uno nuovo a ogni giro: un `useEffect([searchParams])`
 * ripartiva a ogni disegno, e le prove montate non potevano vedere le gare legate all'indirizzo
 * (un effetto che riparte quando non dovrebbe copre quello che parte una volta sola). Adesso
 * l'oggetto cambia solo quando cambia `__QUERY_FINTA__`. Lo stesso per `useParams` senza parametri.
 */
let ultimaQuery;
let ultimiParametri;
export const useSearchParams = () => {
  const q = globalThis.__QUERY_FINTA__ ?? '';
  if (q !== ultimaQuery || !ultimiParametri) {
    ultimaQuery = q;
    ultimiParametri = new URLSearchParams(q);
  }
  return ultimiParametri;
};
const NESSUN_PARAMETRO = Object.freeze({});
export const useParams = () => globalThis.__PARAMETRI_FINTI__ ?? NESSUN_PARAMETRO;
export const redirect = () => {};
export const notFound = () => {};
export const useSelectedLayoutSegment = () => null;
