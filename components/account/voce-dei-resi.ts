/**
 * 1/11/2026 — LA VOCE «RESI» DEL MENU ACCOUNT PORTA AI RESI DEL CLIENTE.
 *
 * Prima puntava a /returns, la pagina che spiega la politica dei resi: chi
 * aveva appena chiesto un reso apriva «Resi» e trovava le regole, non la sua
 * richiesta. Ora porta alla lista dei suoi resi con lo stato di ognuno
 * (app/orders/resi). La politica resta raggiungibile da quella pagina.
 */
export const HREF_DEI_RESI = '/orders/resi';

/**
 * Voce attiva nel menu account. /profile e' attiva solo sulla pagina esatta;
 * «Ordini» (/orders) non si accende sulla lista dei resi, che ha la sua voce.
 */
export function voceAttiva(pathname: string, href: string): boolean {
  if (href === '/profile') return pathname === '/profile';
  if (href === '/orders' && (pathname === HREF_DEI_RESI || pathname.startsWith(HREF_DEI_RESI + '/'))) return false;
  return pathname === href || pathname.startsWith(href + '/');
}
