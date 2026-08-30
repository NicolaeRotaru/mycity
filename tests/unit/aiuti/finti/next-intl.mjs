/**
 * next-intl in finto, ma con le parole VERE: legge `messages/it.json`, così una
 * prova che guarda quello che un lettore di schermo pronuncia legge «Carrello»
 * e non la chiave `cart`.
 */
import messaggi from '../../../../messages/it.json';

function dentro(percorso) {
  return percorso.split('.').reduce((n, p) => (n && typeof n === 'object' ? n[p] : undefined), messaggi);
}

export function useTranslations(spazio) {
  const t = (chiave) => {
    const valore = dentro(spazio ? `${spazio}.${chiave}` : chiave);
    return typeof valore === 'string' ? valore : chiave;
  };
  t.rich = t;
  t.raw = t;
  return t;
}

export const useLocale = () => 'it';
export const useFormatter = () => ({ dateTime: (d) => String(d), number: (n) => String(n) });
export const useMessages = () => messaggi;
export const NextIntlClientProvider = ({ children }) => children;
