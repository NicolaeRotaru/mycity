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
export const useSearchParams = () => new URLSearchParams(globalThis.__QUERY_FINTA__ ?? '');
export const useParams = () => globalThis.__PARAMETRI_FINTI__ ?? {};
export const redirect = () => {};
export const notFound = () => {};
export const useSelectedLayoutSegment = () => null;
