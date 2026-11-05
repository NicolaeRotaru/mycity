import type { StoreSite } from '@/lib/store-site';

/**
 * 351 — Il percorso di un errore del sito vetrina detto in parole:
 * ['menu','links',0,'label'] → «Menu, link 1, nome». Prima al salvataggio
 * compariva solo «Campo obbligatorio», senza dire dove.
 */
const CAMPI: Record<string, string> = {
  label: 'nome', url: 'indirizzo', title: 'titolo', heading: 'titolo', question: 'domanda',
  answer: 'risposta', slug: 'indirizzo della pagina', body: 'testo', alt: 'testo alternativo',
};

export function doveEilProblema(path: ReadonlyArray<PropertyKey>, site: StoreSite | null): string {
  const pezzi: string[] = [];
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const dopo = path[i + 1];
    if (p === 'pages' && typeof dopo === 'number') {
      const titolo = site?.pages[dopo]?.title?.trim();
      pezzi.push(titolo ? `Pagina «${titolo}»` : `Pagina ${dopo + 1}`);
      i++;
    } else if (p === 'sections' && typeof dopo === 'number') { pezzi.push(`blocco ${dopo + 1}`); i++; }
    else if (p === 'links' && typeof dopo === 'number') { pezzi.push(`link ${dopo + 1}`); i++; }
    else if (p === 'items' && typeof dopo === 'number') { pezzi.push(`voce ${dopo + 1}`); i++; }
    else if (p === 'menu') pezzi.push('Menu');
    else if (typeof p === 'string' && CAMPI[p]) pezzi.push(CAMPI[p]);
  }
  return pezzi.join(', ');
}

/**
 * 324 — Un clic su un collegamento interno che porta fuori dall'editor, con la
 * bozza non salvata: si chiede prima. Restituisce true se il clic va fermato.
 */
export function clicDaFermare(
  e: { defaultPrevented: boolean; button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; target: EventTarget | null },
  dirty: boolean,
  pathname: string,
  conferma: (msg: string) => boolean,
): boolean {
  if (!dirty || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a || a.target === '_blank') return false;
  let url: URL;
  try { url = new URL(a.href, window.location.href); } catch { return false; }
  if (url.origin !== window.location.origin || url.pathname === pathname) return false;
  return !conferma('Hai modifiche alla vetrina non salvate: se esci le perdi. Uscire lo stesso?');
}
