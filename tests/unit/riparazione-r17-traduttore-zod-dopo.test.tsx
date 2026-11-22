// @vitest-environment jsdom
/**
 * 22/11/2026 — IL TRADUTTORE DEGLI ERRORI DEI MODULI NON VIAGGIA PIÙ COL PROVIDER DI OGNI PAGINA.
 *
 * QueryProvider sta nel layout radice, cioè in ogni pagina. Importava `@/lib/zod-i18n` in modo
 * statico: il traduttore (e Zod con lui) finiva nel codice comune di tutte le pagine, anche dove non
 * c'è nessun modulo. Adesso il provider lo carica a parte, appena montato.
 *
 * Le due metà della prova:
 *   - importare il provider NON accende il traduttore (se lo portasse con un import statico, anche
 *     attraverso un altro file, l'errore di Zod sarebbe già in italiano prima del montaggio);
 *   - dopo il montaggio, un errore di Zod esce in italiano (i messaggi dei moduli restano italiani).
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } },
}));

const { default: QueryProvider } = await import('@/components/providers/QueryProvider');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Il messaggio che Zod dà a un campo obbligatorio lasciato vuoto. */
const messaggioDelCampoVuoto = () => z.string().min(1).safeParse('').error?.issues[0]?.message;

describe('il traduttore di Zod arriva dopo il montaggio del provider', () => {
  it('importare il provider non porta con sé il traduttore', () => {
    expect(
      messaggioDelCampoVuoto(),
      'il traduttore è già acceso appena importato il provider: viaggia nel codice comune di ogni pagina',
    ).toBe('String must contain at least 1 character(s)');
  });

  it('dopo il montaggio l’errore di Zod esce in italiano', async () => {
    const contenitore = document.createElement('div');
    document.body.appendChild(contenitore);
    const radice = createRoot(contenitore);
    await act(async () => radice.render(createElement(QueryProvider, null, null)));
    await vi.waitFor(() => expect(messaggioDelCampoVuoto()).toBe('Campo obbligatorio'));
    await act(async () => radice.unmount());
  });
});
