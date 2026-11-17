/**
 * R02-004 — Spostata da chi-vuole-cancellarsi-trova-una-strada-che-funziona.test.ts, com'era: una
 * scansione del sorgente non sta con le rotte e con la notte.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

describe("nessuna pagina costruisce la casella privacy di ripiego", () => {
  it("niente mailto scritto a mano sulla casella di ripiego, in nessuna pagina", () => {
    const radice = path.join(process.cwd(), "app");
    const colpevoli: string[] = [];
    const visita = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = path.join(d, n);
        if (statSync(p).isDirectory()) visita(p);
        else if (p.endsWith(".tsx") && /mailto:\$\{[^}]*emailPrivacy\}/.test(readFileSync(p, "utf8"))) {
          colpevoli.push(path.relative(process.cwd(), p));
        }
      }
    };
    visita(radice);
    expect(colpevoli, "queste pagine mostrano un indirizzo che forse nessuno legge: usino recapitoPrivacy()").toEqual([]);
  });
});
