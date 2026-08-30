/** next/navigation in finto: fuori da Next questi hook lanciano, qui rispondono piano. */
const rotta = { push() {}, replace() {}, back() {}, forward() {}, refresh() {}, prefetch() {} };

export const useRouter = () => rotta;
export const usePathname = () => globalThis.__PERCORSO_FINTO__ ?? '/';
export const useSearchParams = () => new URLSearchParams(globalThis.__QUERY_FINTA__ ?? '');
export const useParams = () => globalThis.__PARAMETRI_FINTI__ ?? {};
export const redirect = () => {};
export const notFound = () => {};
export const useSelectedLayoutSegment = () => null;
