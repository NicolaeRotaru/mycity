import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('R09 · il commento di staleCrons dice cosa fa il codice', () => {
  const testo = readFileSync(join(process.cwd(), 'lib/cron-health.ts'), 'utf8')
  it('non dice piu che i lavori senza battito sono ignorati sempre', () => {
    expect(testo).not.toContain('vengono IGNORATI')
    expect(testo).not.toContain('la migrazione 095 li seed-a')
  })
  it('dice che si segnalano dopo la finestra di prima accensione', () => {
    expect(testo).toContain('si segnala solo se si sa da quando esiste il sistema')
    expect(testo).toContain('FINESTRA_PRIMA_ACCENSIONE_MIN')
  })
})
