import { HOME_SECTION_CATALOG, type HomeSite } from '@/lib/home-site';

/**
 * Le regole dell'editor della home prima del salvataggio (5/11/2026).
 * Stanno qui e non nella pagina: una pagina di Next non può esportare funzioni,
 * e una prova le deve poter eseguire. 🟢 Puro.
 */

/** Rimuove elementi incompleti che la validazione rifiuterebbe (es. immagini galleria vuote). */
export function prepareForSave(site: HomeSite): HomeSite {
  return {
    ...site,
    sections: site.sections.map((s) => {
      if (s.type === 'gallery') {
        return { ...s, config: { ...s.config, items: (s.config.items ?? []).filter((it) => it.url.trim()) } };
      }
      // 5/11/2026 (S05) — Un «vantaggio» aggiunto e lasciato del tutto vuoto si
      // toglie: prima bloccava il salvataggio con «Campo obbligatorio» senza dire dove.
      if (s.type === 'liveActivity' && Array.isArray(s.config.bullets)) {
        return { ...s, config: { ...s.config, bullets: s.config.bullets.filter((b) => b.title.trim() || b.desc.trim()) } };
      }
      return s;
    }),
  };
}

/** Il nome di una sezione per chi legge: «Sezione 3 (Attività live + Trust)». */
function nomeDellaSezione(site: HomeSite, indice: number): string {
  const tipo = site.sections[indice]?.type;
  const etichetta = HOME_SECTION_CATALOG.find((m) => m.type === tipo)?.label ?? tipo ?? '';
  return `Sezione ${indice + 1}${etichetta ? ` (${etichetta})` : ''}`;
}

/** Il primo problema della validazione detto con il posto: sezione, vantaggio, campo. */
export function erroreConIlPosto(site: HomeSite, issue: { path: PropertyKey[]; message: string }): string {
  const p = issue.path;
  if (p[0] !== 'sections' || typeof p[1] !== 'number') return issue.message;
  const pezzi = [nomeDellaSezione(site, p[1])];
  const iBullet = p.indexOf('bullets');
  if (iBullet >= 0 && typeof p[iBullet + 1] === 'number') {
    const campo = p[iBullet + 2] === 'title' ? 'manca il titolo' : p[iBullet + 2] === 'desc' ? 'manca la descrizione' : issue.message;
    pezzi.push(`vantaggio ${(p[iBullet + 1] as number) + 1}: ${campo}`);
    return pezzi.join(', ');
  }
  return `${pezzi[0]}: ${issue.message}`;
}

