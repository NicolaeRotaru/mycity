// R15-012 — il pannello della home non suggerisce piu «i piu amati / prodotti che vanno forte».
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('R15-012 · segnaposto della fila «Prodotti popolari»', () => {
  const src = readFileSync('components/admin/home/HomeSectionConfigForm.tsx', 'utf8')
  it('non promette amati o successo', () => {
    expect(src).not.toMatch(/I più amati|Prodotti che vanno forte/)
    expect(src).toContain('placeholder="Appena arrivati"')
    expect(src).toContain('placeholder="Ultimi arrivati dai negozi"')
  })
})
