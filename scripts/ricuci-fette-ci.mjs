#!/usr/bin/env node
/**
 * ricuci-fette-ci — il punto d'ingresso. Rimette insieme i referti delle fette
 * della CI e esce 1 se una prova non ha girato, o ha girato due volte. Cosa
 * controlla e perche': scripts/ricuci-fette-ci.lib.mjs.
 *
 * Uso:
 *   node scripts/ricuci-fette-ci.mjs vitest     <cartella-dei-referti>
 *   node scripts/ricuci-fette-ci.mjs playwright <cartella-dei-referti>
 */
import { principale } from './ricuci-fette-ci.lib.mjs';

process.exit(principale(process.argv.slice(2)));
