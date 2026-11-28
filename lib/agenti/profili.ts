// I link dei profili social nella scheda del cliente — 28/11/2026. Senza dipendenze: li usa anche la pagina del venditore.

/** L'indirizzo del profilo, da mostrare nella scheda come fonte. */
export function linkDelProfilo(canaleSocial: 'Instagram' | 'Facebook' | 'TikTok', nome: string): string {
  if (canaleSocial === 'Instagram') return `https://www.instagram.com/${nome}/`;
  if (canaleSocial === 'TikTok') return `https://www.tiktok.com/@${nome.replace(/^@+/, '')}`;
  return `https://www.facebook.com/${nome}`;
}

/** Il nome del profilo dentro un link Instagram o TikTok («https://www.instagram.com/raquel_cafe23/» → «raquel_cafe23»). */
export function nomeDelProfilo(link: string | null | undefined): string | null {
  const m = String(link ?? '').match(/^https:\/\/(?:www\.|m\.)?(?:instagram\.com\/([A-Za-z0-9._]{1,30})|tiktok\.com\/@([A-Za-z0-9._]{1,30}))\/?$/i);
  return m ? (m[1] ?? m[2]) : null;
}
