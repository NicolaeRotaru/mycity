import { describe, it, expect, vi } from 'vitest';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * R02-001 — il negoziante può scrivere il testo alternativo del banner della vetrina:
 * il campo esiste e quello che scrive arriva in config.alt.
 */
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: [], isError: false, refetch: () => undefined }) }));
vi.mock('@/components/seller/site/ImageUpload', () => ({ SingleImageUpload: () => null }));
vi.mock('@/components/seller/site/CategorySelect', () => ({ default: () => null }));

const { default: BannerFields } = await import('@/components/seller/site/BannerFields');

type Props = Record<string, unknown> & { children?: ReactNode };
function trova(nodo: ReactNode, etichetta: string): Props | null {
  if (Array.isArray(nodo)) {
    for (const n of nodo) { const r = trova(n, etichetta); if (r) return r; }
    return null;
  }
  if (!isValidElement(nodo)) return null;
  const props = (nodo as ReactElement<Props>).props;
  if (props.label === etichetta) return props;
  return trova(props.children, etichetta);
}

const section = (config: Record<string, unknown>) =>
  ({ id: 'b1', type: 'banner', config: { imageUrl: 'https://x/y.jpg', overlay: 'dark', ...config } }) as never;
const albero = (config: Record<string, unknown>, onChange = vi.fn()) =>
  (BannerFields as unknown as (p: unknown) => ReactNode)({ section: section(config), onChange });

describe('R02-001 · campo del testo alternativo del banner', () => {
  it('il campo c è e scrivendoci la callback riceve config.alt', () => {
    const onChange = vi.fn();
    const campo = trova(albero({}, onChange), 'Testo alternativo della foto');
    expect(campo).not.toBeNull();
    expect(campo!.maxLength).toBeUndefined();
    expect(trova(albero({ alt: 'a'.repeat(161) }), 'Testo alternativo della foto')!.error).toMatch(/161 caratteri su 160/);
    expect(trova(albero({ alt: 'a'.repeat(160) }), 'Testo alternativo della foto')!.error).toBeUndefined();
    (campo!.onChange as (e: unknown) => void)({ target: { value: 'Il bancone del forno' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].config.alt).toBe('Il bancone del forno');
  });

  it('mostra l alt già salvato', () => {
    expect(trova(albero({ alt: 'Vetrina' }), 'Testo alternativo della foto')!.value).toBe('Vetrina');
  });

  it('il modulo si disegna per intero con il campo dentro', () => {
    const html = renderToStaticMarkup(createElement(BannerFields as never, { section: section({}), onChange: () => undefined }));
    expect(html).toContain('Testo alternativo della foto');
  });
});
