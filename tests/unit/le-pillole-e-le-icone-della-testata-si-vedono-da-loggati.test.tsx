/**
 * @vitest-environment jsdom
 */
/**
 * 1/11/2026 — DA LOGGATI, LE PILLOLE «ORDINI», «CONSEGNE», «ADMIN» E LE ICONE CUORE, MESSAGGI,
 * CAMPANELLA AVEVANO IL COLORE DELLO SFONDO DELLA TESTATA.
 *
 * Stessa causa del logo e di «Accedi» (vedi il-logo-e-accedi-si-vedono-sulla-testata.test.tsx):
 * globals.css colora ogni link `a { color: var(--primary-700) }`, la testata è bg-primary-700, e
 * questi link non avevano un text-… loro. Le icone disegnano in currentColor: terracotta su
 * terracotta, contrasto 1 a 1. Qui si monta la testata con un utente negoziante+fattorino+admin.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { contrasto, SOGLIA_TESTO } from "./aiuti/contrasto";
import { TAVOLOZZA } from "./aiuti/tavolozza-del-sito";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
}));
vi.mock("next/link", async () => {
  const { createElement: ce } = await import("react");
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce("a", { href: String(href), ...r }, children as never) };
});
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }), signOut: async () => ({}) },
    from: () => ({}),
  },
}));
vi.mock("@/components/hooks/useProfile", () => ({
  useProfile: () => ({ profile: { id: "u-1", role: "seller", full_name: "Mario Rossi" }, userEmail: "m@r.it", isAuthenticated: true, isLoading: false, isSeller: true, isRider: true, isAdmin: true }),
}));
vi.mock("@/components/hooks/useCartCount", () => ({ useCartCount: () => 0 }));
vi.mock("@/components/hooks/useNotificationsCount", () => ({ useNotificationsCount: () => 0 }));
vi.mock("@/components/hooks/useMessagesUnread", () => ({ useMessagesUnread: () => 0 }));
vi.mock("@/components/hooks/useFavorites", () => ({ useFavorites: () => ({ favorites: [] }) }));
vi.mock("@/components/hooks/useBranding", () => ({ useBranding: () => ({ wordmark: { accent: "My", rest: "City" }, name: "MyCity" }) }));
vi.mock("@/components/hooks/useShoppingMode", () => ({ useShoppingMode: () => "buy", useCanPurchase: () => true }));
vi.mock("@/components/LocationPill", () => ({ default: () => null }));
vi.mock("@/components/PromoTicker", () => ({ default: () => null }));
vi.mock("@/components/SearchBar", () => ({ default: () => null }));
vi.mock("@/components/CategoryBar", () => ({ default: () => null }));
vi.mock("@/lib/account-menu", () => ({ getAccountMenuItems: () => [] }));
vi.mock("@/lib/analytics/events", () => ({ trackSignedOut: () => undefined }));
vi.mock("@/lib/push/dispositivo", () => ({ scollegaQuestoDispositivo: async () => undefined }));
vi.mock("@/lib/image-loader", () => ({ default: () => "" }));

import Navbar from "@/components/Navbar";

const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");
const regola = (selettore: string) => {
  const m = new RegExp(`^${selettore}\\s*\\{\\s*color:\\s*var\\(--([a-z]+-\\d+)\\)`, "m").exec(css);
  if (!m) throw new Error(`in globals.css non trovo più la regola ${selettore} { color: var(--…) }`);
  return m[1];
};
const tono = (nome: string) => (nome === "white" ? "#FFFFFF" : TAVOLOZZA.get(nome));

function coloreProprio(el: Element, variante: "" | "hover:"): string | null {
  for (const c of Array.from(el.classList)) {
    if (!c.startsWith(`${variante}text-`)) continue;
    if (variante === "" && c.includes(":")) continue;
    const hex = tono(c.slice(variante.length + "text-".length));
    if (hex) return hex;
  }
  return null;
}
function sfondo(el: Element): string {
  for (let p = el.parentElement; p; p = p.parentElement) {
    for (const c of Array.from(p.classList)) {
      const hex = c.startsWith("bg-") && !c.includes(":") ? tono(c.slice(3)) : undefined;
      if (hex) return hex;
    }
  }
  throw new Error("nessun contenitore con uno sfondo della tavolozza");
}

describe("nella testata, da loggati, pillole e icone si leggono", () => {
  it("Ordini, Consegne, Admin, Preferiti, Messaggi, Notifiche staccano dallo sfondo, fermi e col mouse sopra", async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const radice = document.createElement("div");
    document.body.appendChild(radice);
    const root = createRoot(radice);
    await act(async () => { root.render(createElement(Navbar)); });

    const fermo = tono(regola("a"))!;
    const sopra = tono(regola("a:hover"))!;
    for (const href of ["/seller/orders", "/rider", "/admin", "/favorites", "/messages", "/notifications"]) {
      const link = radice.querySelector(`a[href="${href}"]`);
      expect(link, `${href} non si trova più nella testata`).not.toBeNull();
      const dietro = sfondo(link!);
      const c1 = contrasto(coloreProprio(link!, "") ?? fermo, dietro);
      expect(c1, `${href}: contrasto ${c1.toFixed(2)} contro lo sfondo`).toBeGreaterThanOrEqual(SOGLIA_TESTO);
      const c2 = contrasto(coloreProprio(link!, "hover:") ?? sopra, dietro);
      expect(c2, `${href} col mouse sopra: contrasto ${c2.toFixed(2)}`).toBeGreaterThanOrEqual(SOGLIA_TESTO);
    }
    act(() => root.unmount());
  });
});
