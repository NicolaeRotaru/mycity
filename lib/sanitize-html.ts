import DOMPurify from 'isomorphic-dompurify';

/**
 * Sanitizzazione del testo ricco delle sezioni vetrina (blocco "richText").
 * Funziona sia lato server (route API, sanitizzazione on-write = valore già sicuro
 * a riposo) sia lato client (difesa in profondità prima di dangerouslySetInnerHTML).
 *
 * Allow-list STRETTA: niente script/iframe/style/class/handler. I link sono forzati
 * a https + target/rel sicuri (gli href non-https vengono rimossi).
 */

const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'b', 'i', 'u', 'ul', 'ol', 'li', 'h2', 'h3', 'a', 'blockquote'];
const ALLOWED_ATTR = ['href', 'target', 'rel'];

let hookInstalled = false;
function ensureHook() {
  if (hookInstalled) return;
  // Forza link sicuri: solo https, sempre target=_blank + rel anti-abuso.
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if ((node as Element).tagName === 'A') {
      const el = node as Element;
      const href = el.getAttribute('href') ?? '';
      if (!/^https:\/\//i.test(href)) {
        el.removeAttribute('href');
      } else {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer nofollow');
      }
    }
  });
  hookInstalled = true;
}

/** Ritorna HTML sicuro a partire da input potenzialmente ostile. '' per input vuoto. */
export function sanitizeRichText(dirty: string | null | undefined): string {
  if (!dirty) return '';
  ensureHook();
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input', 'svg', 'math'],
    FORBID_ATTR: ['style', 'class', 'id'],
  }).trim();
}
