import type { ReactNode } from 'react';

/** Intestazione di sezione con barra colore accent (coerente con la vetrina). */
export default function SectionHeading({ children, accent }: { children: ReactNode; accent?: string }) {
  if (!children) return null;
  return (
    <h2 className="text-xl sm:text-2xl font-bold font-serif text-ink-900 mb-4 flex items-center gap-2.5">
      <span
        className="inline-block w-1.5 h-6 rounded-full"
        style={accent ? { backgroundColor: accent } : undefined}
        aria-hidden
      />
      {children}
    </h2>
  );
}
