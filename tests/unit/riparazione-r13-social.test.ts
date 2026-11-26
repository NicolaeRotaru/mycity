import { describe, it, expect } from 'vitest';
import { normalizzaSocials, storeCustomizationSchema, campoDellErrore } from '@/lib/store-customization';

const fb = (url: string) => normalizzaSocials({ facebook: url })?.facebook;

describe('R13-005 — le sottopagine vere di un profilo Facebook tengono il nome', () => {
  it.each(['timeline', 'info', 'photos_by', 'photos_of', 'photos_albums', 'videos_by', 'about_details', 'likes', 'following'])(
    'facebook.com/nome/%s si riduce a «nome»',
    (sotto) => {
      expect(fb(`https://www.facebook.com/panequotidiano/${sotto}`)).toBe('panequotidiano');
      expect(fb(`https://m.facebook.com/pane.quotidiano/${sotto}/?ref=x`)).toBe('pane.quotidiano');
      expect(storeCustomizationSchema.safeParse({ socials: { facebook: fb(`https://facebook.com/nome/${sotto}`) } }).success).toBe(true);
    },
  );
  it('una sottopagina inventata resta fermata', () => {
    expect(fb('https://www.facebook.com/panequotidiano/qualcosa-di-strano')).toBe('https://www.facebook.com/panequotidiano/qualcosa-di-strano');
  });
});

describe('R13-006 — altri percorsi di servizio di Facebook non diventano il nome del profilo', () => {
  const SERVIZIO = [
    'groups', 'events', 'watch', 'marketplace', 'pages', 'people', 'share', 'hashtag', 'gaming', 'help', 'login', 'settings',
    'notifications', 'messages', 'reel', 'reels', 'videos', 'live', 'fundraisers', 'business', 'ads', 'privacy', 'policies',
    'profile', 'story', 'permalink', 'topic', 'topics', 'directory', 'security', 'cookies', 'support', 'inbox', 'oauth',
    'adsmanager', 'instantgames', 'logout', 'recommendations', 'biz', 'creators', 'requests', 'invite', 'tournaments', 'birthdays',
  ];
  it.each([...SERVIZIO, 'profile.php', 'story.php', 'permalink.php', 'photo.php'])('facebook.com/%s resta com\'è ed è fermato', (p) => {
    const url = `https://www.facebook.com/${p}`;
    expect(fb(url)).toBe(url);
    const r = storeCustomizationSchema.safeParse({ socials: { facebook: fb(url) } });
    expect(r.success).toBe(false);
    if (!r.success) expect(campoDellErrore(r.error.issues[0].path)).toBe('Facebook');
  });
  it('i nomi veri restano nomi', () => {
    for (const n of ['panequotidiano', 'pane.quotidiano', 'pane-quotidiano', 'forno2000']) {
      expect(fb(`https://www.facebook.com/${n}`)).toBe(n);
    }
  });
});

describe('R13-007 — tiktok.com/@live è un profilo, tiktok.com/live no', () => {
  const tk = (url: string) => normalizzaSocials({ tiktok: url })?.tiktok;
  it.each(['live', 'foryou', 'following', 'search', 'discover', 'music', 'video', 'tag'])('tiktok.com/@%s con la @ si salva come «%s»', (n) => {
    expect(tk(`https://www.tiktok.com/@${n}`)).toBe(n);
    expect(tk(`https://www.tiktok.com/@${n}/video/123?lang=it`)).toBe(n);
    expect(storeCustomizationSchema.safeParse({ socials: { tiktok: tk(`https://tiktok.com/@${n}`) } }).success).toBe(true);
  });
  it.each(['live', 'foryou', 'tag', 'discover'])('tiktok.com/%s senza la @ resta un percorso riservato', (n) => {
    expect(tk(`https://www.tiktok.com/${n}`)).toBe(`https://www.tiktok.com/${n}`);
  });
  it('un profilo normale e gli altri social non cambiano', () => {
    expect(tk('https://www.tiktok.com/@forno')).toBe('forno');
    expect(normalizzaSocials({ instagram: 'https://www.instagram.com/explore/' })?.instagram).toBe('https://www.instagram.com/explore/');
    expect(normalizzaSocials({ instagram: 'https://www.instagram.com/@p/' })?.instagram).toBe('https://www.instagram.com/@p/');
  });
});

describe('R13-008 — il sito del negozio accetta solo http e https', () => {
  const esito = (w: string) => {
    const n = normalizzaSocials({ website: w })?.website;
    return { n, r: storeCustomizationSchema.safeParse({ socials: { website: n } }) };
  };
  it.each(['ftp://negozio.it', 'mailto:info@negozio.it', 'javascript:alert(1)', 'http//negozio.it', 'https:/negozio.it', 'htp://negozio.it', 'file:///etc/passwd'])(
    '«%s» è rifiutato con un messaggio sul sito',
    (w) => {
      const { r } = esito(w);
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(campoDellErrore(r.error.issues[0].path)).toBe('Sito web');
        expect(r.error.issues[0].message).toMatch(/http:\/\/ o https:\/\//);
      }
    },
  );
  it('un dominio nudo e gli indirizzi giusti funzionano come prima', () => {
    expect(esito('negozio.it').n).toBe('https://negozio.it');
    expect(esito('www.negozio.it/pane').n).toBe('https://www.negozio.it/pane');
    expect(esito('negozio.it:8080').n).toBe('https://negozio.it:8080');
    expect(esito('HTTP://negozio.it').r.success).toBe(true);
    expect(esito('https://negozio.it').r.success).toBe(true);
    expect(esito('').r.success).toBe(true);
  });
});
