/** next/link in finto: quello che conta per l'accessibilità è che esca un <a href>. */
import { createElement, forwardRef } from 'react';

const Link = forwardRef(function Link(props, ref) {
  const { href, children, prefetch, replace, scroll, shallow, locale, ...resto } = props;
  void prefetch; void replace; void scroll; void shallow; void locale;
  return createElement('a', { ref, href: typeof href === 'string' ? href : String(href ?? ''), ...resto }, children);
});

export default Link;
