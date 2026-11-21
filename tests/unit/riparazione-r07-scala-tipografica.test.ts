import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Le misure a mano `text-[Npx]` aggirano la scala tipografica del progetto
// (tailwind.config.ts: 2xs=10, xs=12, sm=14, base=16...). Qui i sei file della
// voce devono usare solo i passi della scala. Le misure senza passo entro 1px
// restano di proposito e sono elencate per misura.
const ROOT = process.cwd();
const FILE: Record<string, Record<string, number>> = {
  "app/category/[slug]/page.tsx": {},
  "app/rider/orders/[id]/page.tsx": { "22px": 1 }, // tra text-xl (20) e text-2xl (24)
  "components/seller/SellerShell.tsx": {},
  "app/rider/earnings/page.tsx": {},
  "app/search/page.tsx": {},
  "components/admin/AdminSidebar.tsx": {},
};

describe("la scala tipografica non è aggirata con misure a mano", () => {
  for (const [file, lasciate] of Object.entries(FILE)) {
    it(`${file}: solo le misure lasciate di proposito`, () => {
      const src = readFileSync(join(ROOT, ...file.split("/")), "utf8");
      const trovate: Record<string, number> = {};
      for (const m of src.matchAll(/text-\[([0-9.]+px)\]/g)) {
        trovate[m[1]] = (trovate[m[1]] ?? 0) + 1;
      }
      expect(trovate).toEqual(lasciate);
    });
  }
});
