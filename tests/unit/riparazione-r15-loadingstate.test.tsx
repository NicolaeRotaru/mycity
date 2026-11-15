// R15-014 — LoadingState annuncia il testo nella regione viva, non solo l'etichetta.
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }))

import { LoadingState } from '@/components/ui/LoadingState'

describe('R15-014 · LoadingState skeleton', () => {
  it('la regione viva contiene il testo, in sr-only', () => {
    const html = renderToStaticMarkup(<LoadingState variant="skeleton" message="Carico gli ordini" />)
    expect(html).toContain('role="status"')
    expect(html).toMatch(/<span class="sr-only">Carico gli ordini<\/span>/)
  })
})
