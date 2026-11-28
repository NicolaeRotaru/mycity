import { leggiSitoDelCliente } from '@/lib/agenzia/sito-finito/leggi';
import { paginaDelSito } from '@/lib/agenzia/sito-finito/costruisci';

/**
 * IL SITO DEL CLIENTE, ONLINE — 28/11/2026.
 *
 * Nicola, 28/11 verso le 14:10: «deve essere già su Vercel il sito del cliente che ha accettato». Questa rotta è il
 * sito: `/sito/raquel-cafe-ffb27af9` è la home, `/sito/raquel-cafe-ffb27af9/chi-siamo` un'altra pagina. È una pagina
 * intera e a sé, senza la testata e il carrello del marketplace: il visitatore vede il sito del locale.
 *
 * `noindex`: questo è l'indirizzo «subito online». Quando il cliente avrà il suo indirizzo (un progetto Vercel suo o
 * il suo dominio), quello sarà l'unico da mostrare a Google; due copie dello stesso sito lo penalizzerebbero.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INTESTAZIONI = {
  'content-type': 'text/html; charset=utf-8',
  'x-robots-tag': 'noindex',
  // Al massimo un minuto: un negozio sospeso sparisce entro un minuto (collaudo 28/11).
  'cache-control': 'public, max-age=0, s-maxage=60',
} as const;

const NON_TROVATO = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Sito non trovato</title><style>body{margin:0;font:1rem/1.6 system-ui,sans-serif;background:#FBF7F2;color:#2C2A28;display:grid;place-items:center;min-height:100vh;padding:21px;text-align:center}a{color:#C0492C}</style></head><body><main><h1>Questo sito non c'è</h1><p>L'indirizzo è sbagliato, oppure il sito non è ancora pronto.</p><p><a href="/">Vai a MyCity</a></p></main></body></html>`;

const nonTrovato = () => new Response(NON_TROVATO, { status: 404, headers: { ...INTESTAZIONI, 'cache-control': 'no-store' } });

export async function GET(req: Request, { params }: { params: Promise<{ indirizzo: string; pagina?: string[] }> }): Promise<Response> {
  const { indirizzo, pagina } = await params;
  if (pagina && pagina.length > 1) return nonTrovato();
  const percorso = pagina?.length ? `/${pagina[0].toLowerCase()}` : '/';

  const sito = await leggiSitoDelCliente(indirizzo);
  if (sito.stato === 'nessuno') return nonTrovato();
  if (sito.stato === 'altrove') {
    const dove = new URL(`${sito.percorso}${percorso === '/' ? '' : percorso}`, req.url);
    return Response.redirect(dove, 308);
  }
  const { sellerId, vetrinaAperta, ...dati } = sito.dati;
  const vetrina = vetrinaAperta ? new URL(`/store/${sellerId}`, req.url).toString() : null;
  const html = paginaDelSito({ ...dati, vetrina }, percorso);
  if (!html) return nonTrovato();
  return new Response(html, { status: 200, headers: INTESTAZIONI });
}
