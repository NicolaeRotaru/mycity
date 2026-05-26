'use client';

import { useRef, useEffect, useState } from 'react';

/**
 * Wrapper che nasconde la `<section>` quando il children non renderizza nulla.
 *
 * Esperti consultati:
 * - UX Researcher: "Sezioni vuote con padding lasciano gap visivi che
 *   suggeriscono 'sito rotto'. Devono sparire del tutto."
 * - SRE: "Usa ref e mutationObserver per detect render finale (children
 *   async via React Query, il primo render è null fino al fetch)."
 */

type Props = {
  children: React.ReactNode;
  className?: string;
};

export default function MaybeSection({ children, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const check = () => {
      if (!ref.current) return;
      const hasContent = (ref.current.textContent ?? '').trim().length > 0 || ref.current.querySelector('img, svg, video, picture') !== null;
      setEmpty(!hasContent);
    };
    check();
    if (!ref.current) return;
    const obs = new MutationObserver(check);
    obs.observe(ref.current, { childList: true, subtree: true });
    return () => obs.disconnect();
  });

  return (
    <section className={empty ? 'hidden' : className} ref={ref as any}>
      {children}
    </section>
  );
}
