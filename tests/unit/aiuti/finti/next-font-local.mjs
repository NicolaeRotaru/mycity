// 25/11/2026 — next/font/local fuori da Next non parte (lo trasforma il compilatore di Next).
// Qui restituisce una famiglia finta: le prove guardano il testo e le classi, non il carattere.
export default function localFont(opzioni = {}) {
  return { className: '', variable: opzioni.variable ?? '', style: { fontFamily: 'carattere-finto' } };
}
