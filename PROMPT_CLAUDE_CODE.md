# Prompt per Claude Code — Crea "Piacenza Market" da zero

> Copia-incolla **tutto** il contenuto qui sotto (dalla riga "Sei un full-stack developer..." fino alla fine) in una nuova sessione di Claude Code, dopo esserti messo in una **cartella vuota**.

---

Sei un full-stack developer esperto. Devi creare da zero un marketplace locale **stile Amazon/eBay** chiamato **"Piacenza Market"** seguendo **esattamente** le specifiche qui sotto. Crea **tutti i file** con il contenuto esatto fornito, senza aggiungere features, refactoring o astrazioni non richieste.

## 1. Obiettivo

Marketplace locale digitale per la città di Piacenza, UI in italiano, stile Amazon/eBay. Tre attori:

- **Buyer** → naviga (home, ricerca, categorie, sottocategorie, negozi, pagina prodotto, pagina negozio), carrello, profilo, ordini, checkout cash-on-delivery.
- **Seller** → area dedicata con sidebar: dashboard con KPI, gestione prodotti (CRUD), pubblicazione con upload immagini, ordini ricevuti, profilo negozio.
- **Admin** → pannello `/admin` per approvare/revocare venditori.

Pagamento **alla consegna in contanti** (no Stripe). Carrello via `localStorage`. Immagini prodotti caricate su **Supabase Storage** (bucket `products`).

## 2. Stack tecnico

- **Next.js 14.2** (App Router, TS strict, dynamic params come `Promise<{...}>`)
- **React 18**
- **Tailwind CSS 3.4** + `tailwind-scrollbar-hide`
- **Supabase** (`@supabase/supabase-js`) → Auth + Postgres + RLS + Storage
- **TanStack Query v5** per data fetching e mutations
- **react-hook-form + zod + @hookform/resolvers** per form
- **react-dropzone** per upload immagini prodotto
- **sonner** per toast
- **leaflet + @types/leaflet** (dipendenze installate, non ancora consumate)
- **resend** (dipendenza installata per email future)

## 3. Struttura del progetto

Crea **esattamente** questi file:

```
piacenza-market/
├── .env.example
├── .gitignore
├── next.config.js
├── package.json
├── postcss.config.js
├── tailwind.config.ts
├── tsconfig.json
├── app/
│   ├── globals.css
│   ├── layout.tsx
│   ├── page.tsx                          # Home stile Amazon: hero + categorie + prodotti + negozi
│   ├── admin/page.tsx                    # Pannello admin (approvazioni)
│   ├── api/auth/signin/route.ts
│   ├── api/auth/signup/route.ts
│   ├── cart/page.tsx                     # 🆕 Pagina carrello
│   ├── category/[slug]/page.tsx          # 🆕 Categoria + sottocategorie + griglia
│   ├── checkout/page.tsx
│   ├── orders/page.tsx
│   ├── product/[id]/page.tsx             # 🆕 Pagina prodotto (galleria, recensioni, correlati)
│   ├── profile/page.tsx                  # 🆕 Profilo buyer
│   ├── search/page.tsx                   # 🆕 Risultati ricerca con filtri
│   ├── sell/page.tsx                     # Onboarding venditore
│   ├── seller/
│   │   ├── layout.tsx                    # 🆕 Layout con sidebar
│   │   ├── dashboard/page.tsx            # 🆕 KPI venditore
│   │   ├── orders/page.tsx               # 🆕 Ordini ricevuti
│   │   ├── products/page.tsx             # 🆕 Lista prodotti seller (CRUD)
│   │   ├── products/new/page.tsx         # 🆕 Nuovo prodotto + upload
│   │   └── profile/page.tsx              # 🆕 Profilo negozio
│   ├── sign-in/page.tsx
│   ├── sign-up/page.tsx
│   ├── store/[id]/page.tsx               # 🆕 Pagina singolo negozio
│   └── stores/page.tsx                   # 🆕 Lista negozi approvati
├── components/
│   ├── CartItem.tsx
│   ├── CategoryBar.tsx                   # 🆕 Barra categorie sotto navbar
│   ├── CategoryShowcase.tsx              # 🆕 Griglia icone categorie
│   ├── Footer.tsx                        # Footer multi-colonna stile Amazon
│   ├── Navbar.tsx                        # Navbar con search + carrello + account
│   ├── ProductCard.tsx                   # Card cliccabile + "Aggiungi al carrello"
│   ├── ProductGrid.tsx                   # 🆕 Griglia con skeleton + empty state
│   ├── SellerSidebar.tsx                 # 🆕 Sidebar area venditore
│   ├── SkeletonCard.tsx                  # 🆕 Loading skeleton cards
│   ├── StoreLocationPicker.tsx           # 🆕 Mappa Leaflet + geocoding indirizzo
│   ├── StoreCard.tsx
│   ├── StoreShowcase.tsx                 # 🆕 Anteprima negozi in home
│   ├── TrustBar.tsx                      # 🆕 Ribbon trust signals sopra navbar
│   ├── ValueProps.tsx                    # 🆕 4 icone benefit
│   ├── VendorForm.tsx                    # Con defaultValues
│   ├── hooks/useCartCount.ts             # 🆕 Hook badge carrello
│   ├── hooks/useProfile.ts               # 🆕 Hook globale ruolo/profile utente
│   └── providers/
│       ├── QueryProvider.tsx
│       └── ToastProvider.tsx
├── lib/
│   ├── cart.ts                           # 🆕 Helpers localStorage carrello
│   ├── constants.ts                      # 🆕 FREE_SHIPPING_THRESHOLD, value props
│   ├── format.ts                         # 🆕 Formatter € e date
│   └── supabase/client.ts                # Client lazy via Proxy
├── migrations/
│   ├── 001_create_tables.sql             # Schema base + RLS + trigger
│   ├── 002_categories_and_extras.sql     # 🆕 categories, storage, extra policy
│   ├── 003_signup_role.sql               # 🆕 Trigger legge role da raw_user_meta_data
│   └── 004_no_admin_approval.sql         # 🆕 Auto-approva seller + colonna store_address
└── types/
    └── globals.d.ts
```

## 4. Flussi funzionali

### Buyer
- `/` — Hero gradient, griglia categorie principali (icone), prodotti in evidenza, anteprima negozi.
- `/search?q=...` — Risultati con sidebar filtri (categoria + prezzo max).
- `/category/[slug]` — Header categoria, chip sottocategorie, griglia prodotti filtrata.
- `/product/[id]` — Galleria immagini, info venditore (link al negozio), prezzo, selettore quantità, "Aggiungi al carrello", recensioni, prodotti correlati per categoria.
- `/stores` — Griglia di tutti i negozi approvati.
- `/store/[id]` — Header negozio + prodotti del negozio (tramite `ProductGrid sellerId={...}`).
- `/cart` — Lista articoli da `localStorage`, modifica quantità, riepilogo, CTA checkout.
- `/checkout` — Form indirizzo + riepilogo + insert in `orders` + `order_items`, payment_status PENDING, delivery_status PREPARATION.
- `/orders` — Storico ordini buyer con badge stato consegna/pagamento.
- `/profile` — Quick-links (ordini, area venditore, carrello) + form dati anagrafici (full_name, phone, address, city, zip).
- `/sign-in`, `/sign-up` — Auth Supabase (la navbar si nasconde su queste route).

### Seller
Tutte sotto `/seller/*`, layout con `SellerSidebar`.
- `/seller/dashboard` — 4 KPI: prodotti totali, in vendita, articoli venduti, fatturato totale + azioni rapide.
- `/seller/products` — Tabella prodotti con thumbnail, categoria, prezzo, stock, stato, azioni (toggle status / elimina).
- `/seller/products/new` — Form (zod) con react-dropzone → upload su bucket Supabase `products` → URL pubblici in `products.images`.
- `/seller/orders` — Tabella ordini ricevuti (filtrati via `products.seller_id`) con select per aggiornare `delivery_status`.
- `/seller/profile` — Stato approvazione + `VendorForm` con `defaultValues` precaricati.

### Onboarding venditore
Il vecchio `/sell` resta come landing per primo onboarding (mostra messaggi di stato e VendorForm). Dopo l'approvazione l'admin imposta `is_approved=true` e l'utente accede a `/seller/dashboard`.

### Logica carrello
Centralizzata in `lib/cart.ts`: `getCart`, `saveCart`, `addToCart`, `removeFromCart`, `updateQuantity`, `clearCart`, `cartTotal`, `cartCount`. Emette `window.dispatchEvent(new Event('cart:updated'))` ad ogni modifica. Il badge in navbar usa `useCartCount` che ascolta `cart:updated` + `storage`.

## 5. Contenuto esatto dei file

---

### `package.json`
```json
{
  "name": "piacenza-market",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "@hookform/resolvers": "^3.3.0",
    "@supabase/supabase-js": "^2.39.0",
    "@tanstack/react-query": "^5.0.0",
    "@types/leaflet": "^1.9.0",
    "leaflet": "^1.9.3",
    "next": "14.2.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-dropzone": "^14.2.4",
    "react-hook-form": "^7.49.0",
    "resend": "^3.0.0",
    "sonner": "^1.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.3.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "autoprefixer": "^10.4.13",
    "postcss": "^8.4.21",
    "tailwind-scrollbar-hide": "^1.0.5"
  }
}
```

### `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "es2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

### `next.config.js`
```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/public/**' },
      { protocol: 'https', hostname: 'placehold.co' },
    ],
  },
};

module.exports = nextConfig;
```

### `postcss.config.js`
```js
module.exports = {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

### `tailwind.config.ts`
```ts
import type { Config } from 'tailwindcss';
import colors from 'tailwindcss/colors';

export default {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: { primary: colors.indigo, secondary: colors.pink },
    },
  },
  plugins: [require('tailwind-scrollbar-hide')],
} satisfies Config;
```
> Nota: `tailwind-scrollbar-hide` è CommonJS e non ha default export TS. Usare `require()` direttamente nell'array `plugins` evita errori di build su Render/Vercel con TS strict.

### `.env.example`
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### `.gitignore`
```
node_modules/
/.pnp
.pnp.js
/coverage
/.next/
/out/
/build
.DS_Store
*.pem
Thumbs.db
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.env
.env.local
.env.development.local
.env.test.local
.env.production.local
.vercel
*.tsbuildinfo
next-env.d.ts
```

### `types/globals.d.ts`
```ts
declare module '*.module.css' {
  const classes: { [key: string]: string };
  export default classes;
}
```

### `app/globals.css`
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body { font-family: 'Inter', sans-serif; }
```

### `app/layout.tsx`
```tsx
import './globals.css';
import { Inter } from 'next/font/google';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import QueryProvider from '@/components/providers/QueryProvider';
import ToastProvider from '@/components/providers/ToastProvider';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: 'Piacenza Market',
  description: 'Il mercato locale di Piacenza',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" suppressHydrationWarning>
      <body className={inter.className}>
        <QueryProvider>
          <Navbar />
          <main className="min-h-screen bg-gray-50">{children}</main>
          <Footer />
        </QueryProvider>
        <ToastProvider />
      </body>
    </html>
  );
}
```

### `lib/supabase/client.ts`
```ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _supabase: SupabaseClient | null = null;

export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    if (!_supabase) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key) throw new Error('Variabili Supabase mancanti: controlla NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY');
      _supabase = createClient(url, key);
    }
    return (_supabase as any)[prop];
  },
});

export const auth = {
  signUp:  async (email: string, password: string) => supabase.auth.signUp({ email, password }),
  signIn:  async (email: string, password: string) => supabase.auth.signInWithPassword({ email, password }),
  signOut: async ()                                 => supabase.auth.signOut(),
};
```

### `lib/cart.ts`
```ts
'use client';

export type CartItem = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
};

const KEY = 'cart';

export const getCart = (): CartItem[] => {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
};

export const saveCart = (items: CartItem[]) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new Event('cart:updated'));
};

export const addToCart = (item: Omit<CartItem, 'quantity'> & { quantity?: number }) => {
  const cart = getCart();
  const existing = cart.find((c) => c.id === item.id);
  if (existing) existing.quantity += item.quantity ?? 1;
  else cart.push({ ...item, quantity: item.quantity ?? 1 });
  saveCart(cart);
};

export const removeFromCart = (id: string) => saveCart(getCart().filter((c) => c.id !== id));

export const updateQuantity = (id: string, quantity: number) => {
  if (quantity < 1) return removeFromCart(id);
  saveCart(getCart().map((c) => (c.id === id ? { ...c, quantity } : c)));
};

export const clearCart = () => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event('cart:updated'));
};

export const cartTotal = (items?: CartItem[]) =>
  (items ?? getCart()).reduce((sum, item) => sum + item.price * item.quantity, 0);

export const cartCount = (items?: CartItem[]) =>
  (items ?? getCart()).reduce((sum, item) => sum + item.quantity, 0);
```

### `lib/format.ts`
```ts
export const formatPrice = (n: number | string) => `€${Number(n).toFixed(2)}`;
export const formatDate = (date: string | Date) =>
  new Date(date).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
```

### `components/hooks/useCartCount.ts`
```ts
'use client';

import { useEffect, useState } from 'react';
import { cartCount } from '@/lib/cart';

export const useCartCount = () => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const update = () => setCount(cartCount());
    update();
    window.addEventListener('cart:updated', update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener('cart:updated', update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return count;
};
```

### `components/providers/QueryProvider.tsx`
```tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export default function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 60 * 1000 } },
  }));
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
```

### `components/providers/ToastProvider.tsx`
```tsx
'use client';

import { Toaster } from 'sonner';

const ToastProvider = () => <Toaster position="top-right" richColors />;
export default ToastProvider;
```

### `components/Navbar.tsx`
```tsx
'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useCartCount } from './hooks/useCartCount';
import CategoryBar from './CategoryBar';

const Navbar = () => {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState('');
  const [user, setUser] = useState<any>(null);
  const cartCount = useCartCount();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    router.push('/sign-in');
    router.refresh();
  };

  if (pathname?.startsWith('/sign-in') || pathname?.startsWith('/sign-up')) return null;

  return (
    <header className="bg-gray-900 text-white sticky top-0 z-50 shadow">
      <div className="container mx-auto flex items-center gap-4 px-4 py-3">
        <Link href="/" className="text-2xl font-extrabold whitespace-nowrap">
          <span className="text-indigo-400">Piacenza</span>Market
        </Link>

        <form onSubmit={handleSearch} className="flex-1 max-w-2xl">
          <div className="flex">
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cerca prodotti, negozi, categorie..."
              className="w-full px-4 py-2 rounded-l-md text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <button type="submit" className="bg-indigo-500 hover:bg-indigo-600 px-4 py-2 rounded-r-md font-semibold">
              🔍
            </button>
          </div>
        </form>

        <nav className="flex items-center gap-5 text-sm">
          {user ? (
            <>
              <Link href="/profile" className="hover:text-indigo-300 hidden sm:inline">
                Ciao, {user.email?.split('@')[0]}
              </Link>
              <Link href="/orders" className="hover:text-indigo-300 hidden sm:inline">Ordini</Link>
              <Link href="/seller/dashboard" className="hover:text-indigo-300">Vendi</Link>
              <button onClick={handleSignOut} className="hover:text-indigo-300">Esci</button>
            </>
          ) : (
            <>
              <Link href="/sign-in" className="hover:text-indigo-300">Accedi</Link>
              <Link href="/sign-up" className="hover:text-indigo-300 hidden sm:inline">Registrati</Link>
            </>
          )}
          <Link href="/cart" className="relative flex items-center gap-1 hover:text-indigo-300">
            <span className="text-xl">🛒</span>
            {cartCount > 0 && (
              <span className="absolute -top-2 -right-3 bg-pink-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {cartCount}
              </span>
            )}
            <span className="hidden sm:inline">Carrello</span>
          </Link>
        </nav>
      </div>
      <CategoryBar />
    </header>
  );
};

export default Navbar;
```

### `components/CategoryBar.tsx`
```tsx
'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';

type Category = { id: string; slug: string; name: string; icon: string | null };

const CategoryBar = () => {
  const { data: categories = [] } = useQuery({
    queryKey: ['top-categories'],
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, slug, name, icon')
        .is('parent_id', null)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="bg-gray-800 border-t border-gray-700">
      <div className="container mx-auto px-4 flex items-center gap-4 overflow-x-auto scrollbar-hide py-2 text-sm">
        <Link href="/stores" className="text-white hover:text-indigo-300 whitespace-nowrap font-semibold">
          🏪 Tutti i negozi
        </Link>
        {categories.map((c) => (
          <Link key={c.id} href={`/category/${c.slug}`} className="text-gray-200 hover:text-white whitespace-nowrap">
            {c.icon} {c.name}
          </Link>
        ))}
      </div>
    </div>
  );
};

export default CategoryBar;
```

### `components/Footer.tsx`
```tsx
import Link from 'next/link';

const Footer = () => (
  <footer className="bg-gray-900 text-gray-300 mt-12">
    <div className="container mx-auto px-6 py-12 grid grid-cols-2 md:grid-cols-4 gap-8">
      <div>
        <h3 className="font-bold text-white mb-3">Conosci Piacenza Market</h3>
        <ul className="space-y-2 text-sm">
          <li><Link href="/" className="hover:underline">Chi siamo</Link></li>
          <li><Link href="/stores" className="hover:underline">Negozi locali</Link></li>
          <li><Link href="/" className="hover:underline">Contattaci</Link></li>
        </ul>
      </div>
      <div>
        <h3 className="font-bold text-white mb-3">Acquista</h3>
        <ul className="space-y-2 text-sm">
          <li><Link href="/search" className="hover:underline">Tutti i prodotti</Link></li>
          <li><Link href="/category/alimentari" className="hover:underline">Alimentari</Link></li>
          <li><Link href="/category/abbigliamento" className="hover:underline">Abbigliamento</Link></li>
          <li><Link href="/category/casa" className="hover:underline">Casa & Cucina</Link></li>
        </ul>
      </div>
      <div>
        <h3 className="font-bold text-white mb-3">Vendi</h3>
        <ul className="space-y-2 text-sm">
          <li><Link href="/sell" className="hover:underline">Diventa venditore</Link></li>
          <li><Link href="/seller/dashboard" className="hover:underline">Area venditori</Link></li>
          <li><Link href="/seller/products/new" className="hover:underline">Pubblica un prodotto</Link></li>
        </ul>
      </div>
      <div>
        <h3 className="font-bold text-white mb-3">Assistenza</h3>
        <ul className="space-y-2 text-sm">
          <li><Link href="/orders" className="hover:underline">I tuoi ordini</Link></li>
          <li><Link href="/profile" className="hover:underline">Il tuo account</Link></li>
          <li><Link href="/cart" className="hover:underline">Il tuo carrello</Link></li>
        </ul>
      </div>
    </div>
    <div className="border-t border-gray-700 py-4 text-center text-xs text-gray-400">
      © {new Date().getFullYear()} Piacenza Market · Il mercato locale della tua città
    </div>
  </footer>
);

export default Footer;
```

### `components/ProductCard.tsx`
```tsx
'use client';

import Link from 'next/link';
import Image from 'next/image';
import { addToCart } from '@/lib/cart';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';

interface ProductCardProps {
  id: string;
  name: string;
  description?: string;
  price: number;
  images?: string[];
  rating?: number;
}

const ProductCard = ({ id, name, description, price, images, rating }: ProductCardProps) => {
  const img = images?.[0] ?? 'https://placehold.co/400x400/eee/aaa?text=Foto';

  const handleAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    addToCart({ id, name, price, image: img });
    toast.success(`${name} aggiunto al carrello`);
  };

  return (
    <Link href={`/product/${id}`} className="group bg-white border rounded-lg overflow-hidden hover:shadow-lg transition-shadow flex flex-col">
      <div className="relative w-full h-48 bg-gray-100 overflow-hidden">
        <Image src={img} alt={name} fill className="object-cover group-hover:scale-105 transition-transform" unoptimized />
      </div>
      <div className="p-3 flex flex-col flex-1">
        <h3 className="font-semibold text-gray-800 line-clamp-2 mb-1">{name}</h3>
        {rating !== undefined && (
          <p className="text-yellow-500 text-sm mb-1">
            {'★'.repeat(Math.round(rating))}{'☆'.repeat(5 - Math.round(rating))}
          </p>
        )}
        {description && <p className="text-gray-500 text-xs line-clamp-2 mb-2">{description}</p>}
        <div className="mt-auto flex justify-between items-center pt-2">
          <span className="text-lg font-bold text-indigo-700">{formatPrice(price)}</span>
          <button
            onClick={handleAdd}
            className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 text-xs font-bold px-3 py-1.5 rounded-full transition-colors"
          >
            + Carrello
          </button>
        </div>
      </div>
    </Link>
  );
};

export default ProductCard;
```

### `components/ProductGrid.tsx`
```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import ProductCard from './ProductCard';

interface Props {
  categoryId?: string;
  sellerId?: string;
  search?: string;
  limit?: number;
  maxPrice?: number;
}

const ProductGrid = ({ categoryId, sellerId, search, limit, maxPrice }: Props) => {
  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products', { categoryId, sellerId, search, limit, maxPrice }],
    queryFn: async () => {
      let q = supabase
        .from('products')
        .select('id, name, description, price, images')
        .eq('status', 'available')
        .order('created_at', { ascending: false });
      if (categoryId) q = q.eq('category_id', categoryId);
      if (sellerId)   q = q.eq('seller_id', sellerId);
      if (search)     q = q.ilike('name', `%${search}%`);
      if (maxPrice)   q = q.lte('price', maxPrice);
      if (limit)      q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  if (isLoading) return <div className="text-center text-gray-500 py-8">Caricamento prodotti...</div>;
  if (products.length === 0) return <div className="text-center text-gray-500 py-8">Nessun prodotto trovato.</div>;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
      {products.map((p: any) => (
        <ProductCard
          key={p.id}
          id={p.id}
          name={p.name}
          description={p.description ?? ''}
          price={Number(p.price)}
          images={Array.isArray(p.images) ? p.images : []}
        />
      ))}
    </div>
  );
};

export default ProductGrid;
```

### `components/CategoryShowcase.tsx`
```tsx
'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';

const CategoryShowcase = () => {
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, slug, name, icon')
        .is('parent_id', null)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4">
      {categories.map((c: any) => (
        <Link key={c.id} href={`/category/${c.slug}`}
          className="bg-white border rounded-lg p-4 text-center hover:shadow-md hover:border-indigo-400 transition-all">
          <div className="text-4xl mb-2">{c.icon}</div>
          <p className="text-sm font-semibold text-gray-700">{c.name}</p>
        </Link>
      ))}
    </div>
  );
};

export default CategoryShowcase;
```

### `components/StoreShowcase.tsx`
```tsx
'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';

const StoreShowcase = () => {
  const { data: stores = [] } = useQuery({
    queryKey: ['stores-showcase'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, store_name, store_phone')
        .eq('is_approved', true)
        .not('store_name', 'is', null)
        .limit(6);
      if (error) throw error;
      return data ?? [];
    },
  });

  if (stores.length === 0) return <p className="text-gray-500 text-sm">Nessun negozio approvato ancora.</p>;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
      {stores.map((s: any) => (
        <Link key={s.id} href={`/store/${s.id}`}
          className="bg-white border rounded-lg p-5 hover:shadow-md transition-all flex items-center gap-4">
          <div className="w-14 h-14 bg-indigo-100 rounded-full flex items-center justify-center text-2xl">🏪</div>
          <div>
            <h3 className="font-bold text-gray-800">{s.store_name}</h3>
            <p className="text-sm text-gray-500">📞 {s.store_phone}</p>
          </div>
        </Link>
      ))}
    </div>
  );
};

export default StoreShowcase;
```

### `components/CartItem.tsx`
```tsx
interface CartItemProps {
  id: string;
  name: string;
  price: number;
  quantity: number;
  onRemove?: (id: string) => void;
  onQuantityChange?: (id: string, quantity: number) => void;
}

const CartItem = ({ id, name, price, quantity, onRemove, onQuantityChange }: CartItemProps) => (
  <div className="border rounded-lg p-4 flex justify-between items-center">
    <div>
      <h3 className="text-lg font-bold">{name}</h3>
      <span className="text-indigo-600 font-semibold">€{price.toFixed(2)}</span>
    </div>
    <div className="flex items-center gap-3">
      {onQuantityChange && (
        <div className="flex items-center gap-2">
          <button onClick={() => onQuantityChange(id, Math.max(1, quantity - 1))}
            className="w-7 h-7 rounded-full border flex items-center justify-center hover:bg-gray-100">−</button>
          <span className="font-semibold w-6 text-center">{quantity}</span>
          <button onClick={() => onQuantityChange(id, quantity + 1)}
            className="w-7 h-7 rounded-full border flex items-center justify-center hover:bg-gray-100">+</button>
        </div>
      )}
      {onRemove && (
        <button onClick={() => onRemove(id)} className="text-red-500 hover:text-red-700 text-sm transition-colors">
          Rimuovi
        </button>
      )}
    </div>
  </div>
);

export default CartItem;
```

### `components/StoreCard.tsx`
```tsx
interface StoreCardProps { id: string; name: string; lat: number; lng: number; phone: string; }

const StoreCard = ({ id, name, lat, lng, phone }: StoreCardProps) => {
  const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
  return (
    <div className="border rounded-lg p-4 space-y-2 hover:shadow-md transition-shadow">
      <h3 className="text-xl font-bold">{name}</h3>
      <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-indigo-600 hover:underline">
        📍 {lat.toFixed(4)}, {lng.toFixed(4)}
      </a>
      <p className="text-gray-600">📞 {phone}</p>
    </div>
  );
};

export default StoreCard;
```

### `components/VendorForm.tsx`
```tsx
'use client';

import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

const VendorSchema = z.object({
  storeName:  z.string().min(3, 'Il nome deve essere di almeno 3 caratteri'),
  storeLat:   z.coerce.number({ invalid_type_error: 'Inserisci una latitudine valida' }),
  storeLng:   z.coerce.number({ invalid_type_error: 'Inserisci una longitudine valida' }),
  storePhone: z.string().length(10, 'Il numero di telefono deve essere di 10 cifre'),
});

export type VendorFormData = z.infer<typeof VendorSchema>;

interface VendorFormProps {
  onSubmit: (data: VendorFormData) => void;
  isLoading?: boolean;
  defaultValues?: Partial<VendorFormData>;
}

const VendorForm = ({ onSubmit, isLoading = false, defaultValues }: VendorFormProps) => {
  const { register, handleSubmit, formState: { errors } } = useForm<VendorFormData>({
    resolver: zodResolver(VendorSchema),
    defaultValues,
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Nome del negozio</label>
        <input {...register('storeName')} type="text" placeholder="Nome del negozio"
          className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        {errors.storeName && <p className="text-red-500 text-sm mt-1">{errors.storeName.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Latitudine</label>
          <input {...register('storeLat')} type="number" step="any" placeholder="45.0526"
            className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          {errors.storeLat && <p className="text-red-500 text-sm mt-1">{errors.storeLat.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Longitudine</label>
          <input {...register('storeLng')} type="number" step="any" placeholder="9.6929"
            className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          {errors.storeLng && <p className="text-red-500 text-sm mt-1">{errors.storeLng.message}</p>}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Telefono</label>
        <input {...register('storePhone')} type="text" placeholder="Telefono (10 cifre)"
          className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        {errors.storePhone && <p className="text-red-500 text-sm mt-1">{errors.storePhone.message}</p>}
      </div>

      <button type="submit" disabled={isLoading}
        className="bg-pink-500 hover:bg-pink-600 disabled:opacity-50 text-white px-4 py-2 rounded transition-colors">
        {isLoading ? 'Salvataggio...' : 'Salva'}
      </button>
    </form>
  );
};

export default VendorForm;
```

### `components/SellerSidebar.tsx`
```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/seller/dashboard',    label: 'Dashboard',         icon: '📊' },
  { href: '/seller/products',     label: 'I miei prodotti',   icon: '📦' },
  { href: '/seller/products/new', label: 'Nuovo prodotto',    icon: '➕' },
  { href: '/seller/orders',       label: 'Ordini ricevuti',   icon: '🛒' },
  { href: '/seller/profile',      label: 'Profilo negozio',   icon: '🏪' },
];

const SellerSidebar = () => {
  const pathname = usePathname();
  return (
    <aside className="bg-white border rounded-lg p-4 h-fit lg:sticky lg:top-24">
      <h2 className="font-bold mb-4 text-gray-800">Area venditore</h2>
      <nav className="space-y-1">
        {links.map((l) => (
          <Link key={l.href} href={l.href}
            className={`flex items-center gap-3 px-3 py-2 rounded transition-colors ${
              pathname === l.href ? 'bg-indigo-100 text-indigo-700 font-semibold' : 'text-gray-700 hover:bg-gray-100'
            }`}>
            <span>{l.icon}</span>
            <span>{l.label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
};

export default SellerSidebar;
```

### `app/page.tsx` (Home stile Amazon)
```tsx
import Link from 'next/link';
import ProductGrid from '@/components/ProductGrid';
import CategoryShowcase from '@/components/CategoryShowcase';
import StoreShowcase from '@/components/StoreShowcase';

export default function Home() {
  return (
    <div className="space-y-12">
      <section className="bg-gradient-to-r from-indigo-600 to-purple-700 text-white">
        <div className="container mx-auto px-6 py-16 flex flex-col md:flex-row items-center gap-8">
          <div className="flex-1 space-y-4">
            <h1 className="text-4xl md:text-5xl font-extrabold">Il mercato locale di Piacenza</h1>
            <p className="text-lg text-indigo-100">
              Scopri prodotti freschi dai negozi della tua città. Consegna a domicilio, pagamento in contanti.
            </p>
            <div className="flex gap-3 flex-wrap">
              <Link href="/search" className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 px-6 py-3 rounded-lg font-bold">
                Acquista ora
              </Link>
              <Link href="/sell" className="bg-white/10 hover:bg-white/20 border border-white/40 px-6 py-3 rounded-lg font-bold">
                Vendi i tuoi prodotti
              </Link>
            </div>
          </div>
          <div className="hidden md:block text-9xl">🛒</div>
        </div>
      </section>

      <section className="container mx-auto px-6">
        <h2 className="text-2xl font-bold mb-6">Esplora le categorie</h2>
        <CategoryShowcase />
      </section>

      <section className="container mx-auto px-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">Prodotti in evidenza</h2>
          <Link href="/search" className="text-indigo-600 hover:underline">Vedi tutto →</Link>
        </div>
        <ProductGrid limit={8} />
      </section>

      <section className="container mx-auto px-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">Negozi a Piacenza</h2>
          <Link href="/stores" className="text-indigo-600 hover:underline">Tutti i negozi →</Link>
        </div>
        <StoreShowcase />
      </section>
    </div>
  );
}
```

### `app/product/[id]/page.tsx`
```tsx
'use client';

import { use, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { addToCart } from '@/lib/cart';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';
import ProductGrid from '@/components/ProductGrid';

export default function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [quantity, setQuantity] = useState(1);

  const { data: product, isLoading } = useQuery({
    queryKey: ['product', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select(`
        *, categories ( slug, name ), profiles!products_seller_id_fkey ( id, store_name )
      `).eq('id', id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: reviews = [] } = useQuery({
    queryKey: ['reviews', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('reviews')
        .select('id, rating, comment, created_at').eq('product_id', id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (isLoading) return <div className="container mx-auto p-8 text-center">Caricamento...</div>;
  if (!product) return <div className="container mx-auto p-8 text-center">Prodotto non trovato.</div>;

  const images: string[] = Array.isArray(product.images) && product.images.length > 0
    ? (product.images as string[])
    : ['https://placehold.co/600x600/eee/aaa?text=Foto+prodotto'];

  const avgRating = reviews.length
    ? reviews.reduce((s: number, r: any) => s + Number(r.rating), 0) / reviews.length
    : 0;

  const handleAdd = () => {
    addToCart({ id: product.id, name: product.name, price: Number(product.price), image: images[0], quantity });
    toast.success(`${product.name} aggiunto al carrello`);
  };

  return (
    <div className="container mx-auto px-6 py-8">
      <nav className="text-sm text-gray-500 mb-4">
        <Link href="/" className="hover:underline">Home</Link> /{' '}
        {product.categories && (
          <>
            <Link href={`/category/${product.categories.slug}`} className="hover:underline">
              {product.categories.name}
            </Link>{' '}/{' '}
          </>
        )}
        <span className="text-gray-700">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div>
          <div className="relative w-full h-96 bg-gray-100 rounded-lg overflow-hidden">
            <Image src={images[0]} alt={product.name} fill className="object-contain" unoptimized />
          </div>
          {images.length > 1 && (
            <div className="grid grid-cols-4 gap-2 mt-3">
              {images.slice(1, 5).map((img, i) => (
                <div key={i} className="relative aspect-square bg-gray-100 rounded">
                  <Image src={img} alt="" fill className="object-cover rounded" unoptimized />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <h1 className="text-3xl font-bold text-gray-900">{product.name}</h1>

          {product.profiles && (
            <Link href={`/store/${product.profiles.id}`} className="text-sm text-indigo-600 hover:underline inline-block">
              Venduto da {product.profiles.store_name}
            </Link>
          )}

          {reviews.length > 0 && (
            <p className="text-yellow-500">
              {'★'.repeat(Math.round(avgRating))}{'☆'.repeat(5 - Math.round(avgRating))}{' '}
              <span className="text-gray-500 text-sm">({reviews.length} recensioni)</span>
            </p>
          )}

          <div className="text-4xl font-bold text-indigo-700">{formatPrice(Number(product.price))}</div>
          <p className="text-gray-600 leading-relaxed whitespace-pre-line">{product.description}</p>

          <div className="bg-gray-50 border rounded-lg p-5 space-y-4">
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium">Quantità:</label>
              <div className="flex items-center gap-2">
                <button onClick={() => setQuantity(Math.max(1, quantity - 1))} className="w-8 h-8 border rounded hover:bg-gray-100">−</button>
                <span className="w-10 text-center font-semibold">{quantity}</span>
                <button onClick={() => setQuantity(quantity + 1)} className="w-8 h-8 border rounded hover:bg-gray-100">+</button>
              </div>
            </div>
            <button onClick={handleAdd}
              className="w-full bg-yellow-400 hover:bg-yellow-500 text-gray-900 py-3 rounded-lg font-bold transition-colors">
              🛒 Aggiungi al carrello
            </button>
            <p className="text-xs text-gray-500 text-center">💳 Pagamento alla consegna · 🚚 Spedito da venditori locali</p>
          </div>
        </div>
      </div>

      <section className="mt-12">
        <h2 className="text-2xl font-bold mb-4">Recensioni</h2>
        {reviews.length === 0 ? (
          <p className="text-gray-500">Nessuna recensione ancora.</p>
        ) : (
          <div className="space-y-3">
            {reviews.map((r: any) => (
              <div key={r.id} className="bg-white border rounded-lg p-4">
                <p className="text-yellow-500 mb-1">
                  {'★'.repeat(Math.round(Number(r.rating)))}{'☆'.repeat(5 - Math.round(Number(r.rating)))}
                </p>
                <p className="text-gray-700">{r.comment}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {product.category_id && (
        <section className="mt-12">
          <h2 className="text-2xl font-bold mb-4">Potrebbe piacerti anche</h2>
          <ProductGrid categoryId={product.category_id} limit={4} />
        </section>
      )}
    </div>
  );
}
```

### `app/cart/page.tsx`
```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { CartItem, getCart, updateQuantity, removeFromCart, cartTotal } from '@/lib/cart';
import { formatPrice } from '@/lib/format';

export default function CartPage() {
  const [items, setItems] = useState<CartItem[]>([]);

  useEffect(() => {
    const refresh = () => setItems(getCart());
    refresh();
    window.addEventListener('cart:updated', refresh);
    return () => window.removeEventListener('cart:updated', refresh);
  }, []);

  const total = cartTotal(items);

  if (items.length === 0) {
    return (
      <div className="container mx-auto p-12 text-center space-y-4">
        <p className="text-6xl">🛒</p>
        <h1 className="text-2xl font-bold">Il tuo carrello è vuoto</h1>
        <p className="text-gray-500">Aggiungi prodotti per iniziare lo shopping</p>
        <Link href="/" className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-lg">
          Scopri i prodotti
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-2 space-y-4">
        <h1 className="text-2xl font-bold mb-4">Il tuo carrello ({items.length} articoli)</h1>
        {items.map((item) => (
          <div key={item.id} className="bg-white border rounded-lg p-4 flex gap-4">
            <div className="relative w-24 h-24 bg-gray-100 rounded shrink-0">
              <Image src={item.image ?? 'https://placehold.co/200x200/eee/aaa?text=Foto'} alt={item.name}
                fill className="object-cover rounded" unoptimized />
            </div>
            <div className="flex-1 flex flex-col justify-between">
              <Link href={`/product/${item.id}`} className="font-semibold hover:text-indigo-600">{item.name}</Link>
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-2">
                  <button onClick={() => updateQuantity(item.id, item.quantity - 1)}
                    className="w-7 h-7 border rounded hover:bg-gray-50">−</button>
                  <span className="w-8 text-center font-semibold">{item.quantity}</span>
                  <button onClick={() => updateQuantity(item.id, item.quantity + 1)}
                    className="w-7 h-7 border rounded hover:bg-gray-50">+</button>
                  <button onClick={() => removeFromCart(item.id)} className="text-red-500 hover:text-red-700 text-sm ml-3">
                    Rimuovi
                  </button>
                </div>
                <span className="font-bold text-indigo-700">{formatPrice(item.price * item.quantity)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white border rounded-lg p-6 h-fit space-y-4 lg:sticky lg:top-24">
        <h2 className="text-lg font-bold">Riepilogo</h2>
        <div className="flex justify-between text-sm"><span>Subtotale</span><span>{formatPrice(total)}</span></div>
        <div className="flex justify-between text-sm"><span>Spedizione</span><span className="text-green-600 font-semibold">Gratuita</span></div>
        <div className="border-t pt-3 flex justify-between font-bold text-lg">
          <span>Totale</span><span className="text-indigo-700">{formatPrice(total)}</span>
        </div>
        <Link href="/checkout"
          className="block w-full text-center bg-yellow-400 hover:bg-yellow-500 text-gray-900 py-3 rounded-lg font-bold transition-colors">
          Procedi al checkout
        </Link>
        <p className="text-xs text-gray-500 text-center">💳 Pagamento in contanti alla consegna</p>
      </div>
    </div>
  );
}
```

### `app/profile/page.tsx`
```tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';

type ProfileForm = { full_name: string; phone: string; address: string; city: string; zip: string; };

export default function ProfilePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { register, handleSubmit, reset } = useForm<ProfileForm>();

  const { data: profile, isLoading, error } = useQuery({
    queryKey: ['my-profile'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      if (error) throw error;
      return { ...data, email: user.email };
    },
  });

  useEffect(() => {
    if (profile) reset({
      full_name: profile.full_name ?? '',
      phone:     profile.phone ?? '',
      address:   profile.address ?? '',
      city:      profile.city ?? '',
      zip:       profile.zip ?? '',
    });
  }, [profile, reset]);

  const update = useMutation({
    mutationFn: async (form: ProfileForm) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { error } = await supabase.from('profiles').update(form).eq('id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-profile'] });
      toast.success('Profilo aggiornato!');
    },
    onError: (err: any) => toast.error(err.message),
  });

  if (isLoading) return <div className="container mx-auto p-8 text-center">Caricamento...</div>;
  if (error || !profile) {
    if (typeof window !== 'undefined') router.push('/sign-in');
    return null;
  }

  return (
    <div className="container mx-auto px-6 py-8 max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">Il tuo account</h1>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <Link href="/orders" className="bg-white border rounded-lg p-5 hover:shadow-md transition-shadow">
          <div className="text-3xl mb-2">📦</div><h3 className="font-bold">I tuoi ordini</h3>
          <p className="text-sm text-gray-500">Traccia, restituisci e ripeti gli acquisti</p>
        </Link>
        <Link href="/seller/dashboard" className="bg-white border rounded-lg p-5 hover:shadow-md transition-shadow">
          <div className="text-3xl mb-2">🏪</div><h3 className="font-bold">Area venditore</h3>
          <p className="text-sm text-gray-500">Gestisci il tuo negozio</p>
        </Link>
        <Link href="/cart" className="bg-white border rounded-lg p-5 hover:shadow-md transition-shadow">
          <div className="text-3xl mb-2">🛒</div><h3 className="font-bold">Il tuo carrello</h3>
          <p className="text-sm text-gray-500">Articoli in attesa</p>
        </Link>
      </div>

      <div className="bg-white border rounded-lg p-6">
        <h2 className="text-lg font-bold mb-4">Dati personali</h2>
        <p className="text-sm text-gray-500 mb-4">Email: <span className="font-mono">{profile.email}</span></p>
        <form onSubmit={handleSubmit((d) => update.mutate(d))} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium mb-1">Nome e cognome</label>
            <input {...register('full_name')} className="w-full border p-2 rounded" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Telefono</label>
            <input {...register('phone')} className="w-full border p-2 rounded" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">CAP</label>
            <input {...register('zip')} className="w-full border p-2 rounded" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium mb-1">Indirizzo</label>
            <input {...register('address')} className="w-full border p-2 rounded" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium mb-1">Città</label>
            <input {...register('city')} className="w-full border p-2 rounded" />
          </div>
          <button type="submit" disabled={update.isPending}
            className="sm:col-span-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white py-2 rounded transition-colors">
            {update.isPending ? 'Salvataggio...' : 'Salva modifiche'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

### `app/search/page.tsx`
```tsx
'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import ProductGrid from '@/components/ProductGrid';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';

function SearchInner() {
  const params = useSearchParams();
  const q = params.get('q') ?? '';
  const [maxPrice, setMaxPrice] = useState<number | ''>('');
  const [categoryId, setCategoryId] = useState<string>('');

  const { data: categories = [] } = useQuery({
    queryKey: ['all-categories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('categories').select('id, slug, name').order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="container mx-auto px-6 py-6 grid grid-cols-1 md:grid-cols-4 gap-6">
      <aside className="md:col-span-1 bg-white border rounded-lg p-4 h-fit space-y-4">
        <h2 className="font-bold">Filtri</h2>
        <div>
          <label className="block text-sm font-medium mb-1">Categoria</label>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full border p-2 rounded text-sm">
            <option value="">Tutte</option>
            {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Prezzo massimo</label>
          <input type="number" value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value ? Number(e.target.value) : '')}
            placeholder="€" className="w-full border p-2 rounded text-sm" />
        </div>
      </aside>

      <main className="md:col-span-3">
        <h1 className="text-2xl font-bold mb-6">{q ? `Risultati per "${q}"` : 'Tutti i prodotti'}</h1>
        <ProductGrid search={q || undefined} categoryId={categoryId || undefined}
          maxPrice={typeof maxPrice === 'number' ? maxPrice : undefined} />
      </main>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="container mx-auto p-8 text-center">Caricamento...</div>}>
      <SearchInner />
    </Suspense>
  );
}
```

### `app/category/[slug]/page.tsx`
```tsx
'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import ProductGrid from '@/components/ProductGrid';

export default function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);

  const { data: category, isLoading } = useQuery({
    queryKey: ['category', slug],
    queryFn: async () => {
      const { data, error } = await supabase.from('categories')
        .select('id, slug, name, icon, parent_id').eq('slug', slug).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: subcategories = [] } = useQuery({
    queryKey: ['subcategories', category?.id],
    queryFn: async () => {
      if (!category) return [];
      const { data, error } = await supabase.from('categories')
        .select('id, slug, name, icon').eq('parent_id', category.id).order('name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!category,
  });

  if (isLoading) return <div className="container mx-auto p-8 text-center">Caricamento...</div>;
  if (!category) return <div className="container mx-auto p-8 text-center">Categoria non trovata.</div>;

  return (
    <div className="container mx-auto px-6 py-8 space-y-8">
      <header className="flex items-center gap-4">
        <span className="text-5xl">{category.icon}</span>
        <div>
          <h1 className="text-3xl font-bold">{category.name}</h1>
          <p className="text-gray-500">Esplora i prodotti della categoria</p>
        </div>
      </header>

      {subcategories.length > 0 && (
        <section>
          <h2 className="text-xl font-bold mb-3">Sottocategorie</h2>
          <div className="flex flex-wrap gap-3">
            {subcategories.map((s: any) => (
              <Link key={s.id} href={`/category/${s.slug}`}
                className="bg-white border rounded-full px-4 py-2 hover:bg-indigo-50 hover:border-indigo-400 text-sm font-medium">
                {s.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-xl font-bold mb-4">Prodotti</h2>
        <ProductGrid categoryId={category.id} />
      </section>
    </div>
  );
}
```

### `app/stores/page.tsx`
```tsx
'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';

export default function StoresPage() {
  const { data: stores = [], isLoading } = useQuery({
    queryKey: ['stores'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles')
        .select('id, store_name, store_phone, store_lat, store_lng')
        .eq('is_approved', true).not('store_name', 'is', null).order('store_name');
      if (error) throw error;
      return data ?? [];
    },
  });

  if (isLoading) return <div className="container mx-auto p-8 text-center">Caricamento...</div>;

  return (
    <div className="container mx-auto px-6 py-8">
      <h1 className="text-3xl font-bold mb-6">Negozi a Piacenza</h1>
      {stores.length === 0 ? (
        <p className="text-gray-500">Nessun negozio approvato ancora.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {stores.map((s: any) => (
            <Link key={s.id} href={`/store/${s.id}`}
              className="bg-white border rounded-lg p-6 hover:shadow-lg transition-shadow space-y-2">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center text-2xl">🏪</div>
                <h3 className="font-bold text-lg">{s.store_name}</h3>
              </div>
              <p className="text-sm text-gray-500">📞 {s.store_phone}</p>
              {s.store_lat && s.store_lng && (
                <span className="text-sm text-indigo-600 inline-block">
                  📍 {Number(s.store_lat).toFixed(4)}, {Number(s.store_lng).toFixed(4)}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

### `app/store/[id]/page.tsx`
```tsx
'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import ProductGrid from '@/components/ProductGrid';

export default function StorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: store, isLoading } = useQuery({
    queryKey: ['store', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles')
        .select('id, store_name, store_phone, store_lat, store_lng, is_approved')
        .eq('id', id).single();
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) return <div className="container mx-auto p-8 text-center">Caricamento...</div>;
  if (!store?.store_name || !store.is_approved)
    return <div className="container mx-auto p-8 text-center">Negozio non trovato.</div>;

  return (
    <div className="container mx-auto px-6 py-8 space-y-8">
      <header className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl p-8 flex items-center gap-6">
        <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center text-4xl">🏪</div>
        <div>
          <h1 className="text-3xl font-bold">{store.store_name}</h1>
          <p className="text-indigo-100">📞 {store.store_phone}</p>
          {store.store_lat && store.store_lng && (
            <a href={`https://www.google.com/maps?q=${store.store_lat},${store.store_lng}`}
              target="_blank" rel="noopener noreferrer" className="text-white/90 hover:text-white text-sm underline">
              📍 Apri su Google Maps
            </a>
          )}
        </div>
      </header>

      <section>
        <h2 className="text-2xl font-bold mb-4">Prodotti del negozio</h2>
        <ProductGrid sellerId={store.id} />
      </section>
    </div>
  );
}
```

### `app/sign-in/page.tsx`
```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/supabase/client';
import { toast } from 'sonner';

const SignIn = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const { error } = await auth.signIn(email, password);
      if (error) throw error;
      toast.success('Accesso effettuato!');
      router.push('/');
      router.refresh();
    } catch (error: any) {
      toast.error(error.message || 'Errore durante il login');
    } finally { setIsLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-xl shadow-md w-full max-w-md space-y-6">
        <h2 className="text-2xl font-bold text-gray-800">Accedi</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="la-tua@email.it" required
              className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" required
              className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          <button type="submit" disabled={isLoading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded transition-colors">
            {isLoading ? 'Accesso in corso...' : 'Accedi'}
          </button>
        </form>
        <p className="text-center text-sm text-gray-600">
          Non hai un account? <Link href="/sign-up" className="text-indigo-600 hover:underline">Registrati</Link>
        </p>
      </div>
    </div>
  );
};

export default SignIn;
```

### `app/sign-up/page.tsx`
Identico a `sign-in` ma con `auth.signUp`, titolo "Registrati", link inverso, e `minLength={6}` sulla password. Vedi struttura sopra (cambia solo la funzione invocata e il messaggio di successo: `'Registrazione completata! Controlla la tua email.'` con redirect a `/sign-in`).

### `app/api/auth/signin/route.ts`
```ts
import { auth } from '@/lib/supabase/client';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const { email, password } = await request.json();
  try {
    const { data, error } = await auth.signIn(email, password);
    if (error) throw error;
    return NextResponse.json(data, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message ?? 'Failed to sign in' }, { status: 401 });
  }
}
```

### `app/api/auth/signup/route.ts`
Identico a `signin` ma chiama `auth.signUp` e ritorna status 201 (fallback error 400).

### `app/sell/page.tsx`
```tsx
'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import VendorForm, { VendorFormData } from '@/components/VendorForm';
import { toast } from 'sonner';

const fetchProfile = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Non autenticato');
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (error) throw error;
  return data;
};

const Sell = () => {
  const { data: profile, isLoading } = useQuery({ queryKey: ['profile'], queryFn: fetchProfile });

  const updateProfile = useMutation({
    mutationFn: async (formData: VendorFormData) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { error } = await supabase.from('profiles').update({
        store_name:  formData.storeName,
        store_lat:   formData.storeLat,
        store_lng:   formData.storeLng,
        store_phone: formData.storePhone,
        role:        'pending_approval',
      }).eq('id', user.id);
      if (error) throw error;
    },
    onSuccess: () => toast.success('Profilo negozio salvato!'),
    onError: (err: any) => toast.error(err.message || 'Errore nel salvataggio'),
  });

  if (isLoading) return <div className="container mx-auto p-8 text-center">Caricamento...</div>;

  return (
    <div className="container mx-auto p-8 max-w-lg">
      <h2 className="text-2xl font-bold mb-6">Vendi su Piacenza Market</h2>
      {profile?.is_approved ? (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-green-800">
          ✅ Il tuo negozio è approvato e attivo.
        </div>
      ) : profile?.role === 'pending_approval' ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-800 mb-6">
          ⏳ La tua richiesta è in attesa di approvazione.
        </div>
      ) : null}
      <VendorForm onSubmit={(data) => updateProfile.mutate(data)} isLoading={updateProfile.isPending} />
    </div>
  );
};

export default Sell;
```

### `app/checkout/page.tsx`
```tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { CartItem, getCart, cartTotal, clearCart } from '@/lib/cart';
import { formatPrice } from '@/lib/format';

type AddressForm = { fullName: string; address: string; city: string; zip: string; phone: string; };

export default function CheckoutPage() {
  const router = useRouter();
  const [cart, setCart] = useState<CartItem[]>([]);
  useEffect(() => setCart(getCart()), []);
  const total = cartTotal(cart);

  const [form, setForm] = useState<AddressForm>({ fullName: '', address: '', city: '', zip: '', phone: '' });
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const placeOrder = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Devi essere autenticato per completare l\'ordine');
      if (cart.length === 0) throw new Error('Il carrello è vuoto');

      const { data: order, error: orderError } = await supabase.from('orders').insert({
        user_id: user.id, total_price: total, payment_status: 'PENDING', delivery_status: 'PREPARATION',
      }).select().single();
      if (orderError) throw orderError;

      const items = cart.map((item) => ({
        order_id: order.id, product_id: item.id, quantity: item.quantity, unit_price: item.price,
      }));
      const { error: itemsError } = await supabase.from('order_items').insert(items);
      if (itemsError) throw itemsError;
      return order;
    },
    onSuccess: () => {
      clearCart();
      toast.success('Ordine effettuato con successo!');
      router.push('/orders');
    },
    onError: (err: any) => toast.error(err.message || 'Errore durante il checkout'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (Object.entries(form).find(([, v]) => !v.trim())) { toast.error('Compila tutti i campi'); return; }
    placeOrder.mutate();
  };

  if (cart.length === 0) return (
    <div className="container mx-auto p-8 text-center space-y-4">
      <p className="text-gray-500 text-lg">Il tuo carrello è vuoto.</p>
      <a href="/" className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg transition-colors">
        Torna al negozio
      </a>
    </div>
  );

  return (
    <div className="container mx-auto p-8 max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-800 mb-8">Checkout</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div>
          <h2 className="text-lg font-semibold text-gray-700 mb-4">Indirizzo di consegna</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            {[
              { name: 'fullName', label: 'Nome e cognome', placeholder: 'Mario Rossi', type: 'text' },
              { name: 'address',  label: 'Indirizzo',       placeholder: 'Via Roma 1',   type: 'text' },
              { name: 'city',     label: 'Città',           placeholder: 'Piacenza',     type: 'text' },
              { name: 'zip',      label: 'CAP',             placeholder: '29121',        type: 'text' },
              { name: 'phone',    label: 'Telefono',        placeholder: '3331234567',   type: 'tel'  },
            ].map((field) => (
              <div key={field.name}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}</label>
                <input type={field.type} name={field.name} value={form[field.name as keyof AddressForm]}
                  onChange={handleChange} placeholder={field.placeholder}
                  className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
            ))}
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
              💳 Il pagamento avverrà in contanti alla consegna.
            </div>
            <button type="submit" disabled={placeOrder.isPending}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white py-3 rounded-lg font-semibold transition-colors">
              {placeOrder.isPending ? 'Elaborazione...' : `Conferma ordine · ${formatPrice(total)}`}
            </button>
          </form>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-gray-700 mb-4">Riepilogo ordine</h2>
          <div className="bg-white border rounded-xl overflow-hidden shadow-sm">
            <div className="divide-y">
              {cart.map((item) => (
                <div key={item.id} className="flex justify-between items-center px-5 py-3">
                  <div><p className="font-medium text-gray-800">{item.name}</p>
                    <p className="text-sm text-gray-400">×{item.quantity}</p></div>
                  <span className="font-semibold text-gray-800">{formatPrice(item.price * item.quantity)}</span>
                </div>
              ))}
            </div>
            <div className="bg-gray-50 border-t px-5 py-4 flex justify-between items-center">
              <span className="font-bold text-gray-700">Totale</span>
              <span className="text-xl font-bold text-indigo-700">{formatPrice(total)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

### `app/orders/page.tsx`
```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import { formatPrice, formatDate } from '@/lib/format';

type OrderItem = { id: string; quantity: number; unit_price: number; product_id: string; products: { name: string }[] | null; };
type Order = {
  id: string; total_price: number;
  payment_status: 'PAID'|'FAILED'|'PENDING';
  delivery_status: 'PREPARATION'|'SHIPPED'|'DELIVERED';
  created_at: string; order_items: OrderItem[];
};

const paymentBadge: Record<Order['payment_status'], { label: string; classes: string }> = {
  PAID:    { label: 'Pagato',    classes: 'bg-green-100 text-green-700' },
  PENDING: { label: 'In attesa', classes: 'bg-yellow-100 text-yellow-700' },
  FAILED:  { label: 'Fallito',   classes: 'bg-red-100 text-red-700' },
};
const deliveryBadge: Record<Order['delivery_status'], { label: string; classes: string }> = {
  PREPARATION: { label: '📦 Preparazione', classes: 'bg-blue-100 text-blue-700' },
  SHIPPED:     { label: '🚚 Spedito',      classes: 'bg-indigo-100 text-indigo-700' },
  DELIVERED:   { label: '✅ Consegnato',   classes: 'bg-green-100 text-green-700' },
};

export default function OrdersPage() {
  const { data: orders = [], isLoading, error } = useQuery({
    queryKey: ['orders'],
    queryFn: async (): Promise<Order[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase.from('orders').select(`
        id, total_price, payment_status, delivery_status, created_at,
        order_items ( id, quantity, unit_price, product_id, products ( name ) )
      `).eq('user_id', user.id).order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Order[];
    },
  });

  if (isLoading) return <div className="container mx-auto p-8 text-center text-gray-500">Caricamento ordini...</div>;
  if (error) return <div className="container mx-auto p-8 text-center text-red-500">Errore nel caricamento degli ordini.</div>;
  if (orders.length === 0) return (
    <div className="container mx-auto p-8 text-center space-y-4">
      <p className="text-gray-500 text-lg">Non hai ancora nessun ordine.</p>
      <Link href="/" className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg transition-colors">
        Scopri i prodotti
      </Link>
    </div>
  );

  return (
    <div className="container mx-auto p-8 max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">I tuoi ordini</h1>
      {orders.map((order) => {
        const payment = paymentBadge[order.payment_status];
        const delivery = deliveryBadge[order.delivery_status];
        return (
          <div key={order.id} className="bg-white border rounded-xl shadow-sm overflow-hidden">
            <div className="bg-gray-50 border-b px-5 py-3 flex flex-wrap justify-between items-center gap-2">
              <div>
                <p className="text-xs text-gray-400 font-mono">#{order.id.slice(0, 8).toUpperCase()}</p>
                <p className="text-sm text-gray-600">{formatDate(order.created_at)}</p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <span className={`text-xs font-semibold px-3 py-1 rounded-full ${payment.classes}`}>{payment.label}</span>
                <span className={`text-xs font-semibold px-3 py-1 rounded-full ${delivery.classes}`}>{delivery.label}</span>
              </div>
            </div>
            <div className="px-5 py-4 space-y-2">
              {order.order_items.map((item) => (
                <div key={item.id} className="flex justify-between text-sm">
                  <span className="text-gray-700">
                    {item.products?.[0]?.name ?? 'Prodotto rimosso'}
                    <span className="text-gray-400 ml-2">×{item.quantity}</span>
                  </span>
                  <span className="font-medium text-gray-800">{formatPrice(item.unit_price * item.quantity)}</span>
                </div>
              ))}
            </div>
            <div className="border-t px-5 py-3 flex justify-end">
              <span className="text-base font-bold text-indigo-700">Totale: {formatPrice(order.total_price)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

### `app/admin/page.tsx`
```tsx
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';

type Profile = { id: string; role: string; store_name: string | null; is_approved: boolean; };

const Admin = () => {
  const queryClient = useQueryClient();

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ['profiles'],
    queryFn: async (): Promise<Profile[]> => {
      const { data, error } = await supabase.from('profiles').select('*');
      if (error) throw error;
      return data ?? [];
    },
  });

  const toggleApproval = useMutation({
    mutationFn: async ({ id, is_approved }: { id: string; is_approved: boolean }) => {
      const { error } = await supabase.from('profiles')
        .update({ is_approved, role: is_approved ? 'seller' : 'pending_approval' }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      toast.success('Stato aggiornato');
    },
    onError: (err: any) => toast.error(err.message),
  });

  if (isLoading) return <div className="container mx-auto p-8 text-center">Caricamento...</div>;

  return (
    <div className="container mx-auto p-8">
      <h2 className="text-2xl font-bold mb-6">Pannello Admin</h2>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse bg-white shadow rounded-lg overflow-hidden">
          <thead className="bg-indigo-600 text-white">
            <tr>
              <th className="p-3 text-left">ID</th>
              <th className="p-3 text-left">Ruolo</th>
              <th className="p-3 text-left">Nome Negozio</th>
              <th className="p-3 text-left">Approvato</th>
              <th className="p-3 text-left">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((profile) => (
              <tr key={profile.id} className="border-t hover:bg-gray-50">
                <td className="p-3 text-xs text-gray-500 font-mono">{profile.id.slice(0, 8)}…</td>
                <td className="p-3">{profile.role}</td>
                <td className="p-3">{profile.store_name ?? '—'}</td>
                <td className="p-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-semibold ${profile.is_approved ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                    {profile.is_approved ? 'Sì' : 'No'}
                  </span>
                </td>
                <td className="p-3">
                  <button onClick={() => toggleApproval.mutate({ id: profile.id, is_approved: !profile.is_approved })}
                    className={`text-sm px-3 py-1 rounded transition-colors ${profile.is_approved ? 'bg-red-100 hover:bg-red-200 text-red-700' : 'bg-green-100 hover:bg-green-200 text-green-700'}`}>
                    {profile.is_approved ? 'Revoca' : 'Approva'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Admin;
```

### `app/seller/layout.tsx`
```tsx
import SellerSidebar from '@/components/SellerSidebar';

export default function SellerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="container mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
      <SellerSidebar />
      <main>{children}</main>
    </div>
  );
}
```

### `app/seller/dashboard/page.tsx`
```tsx
'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';

export default function SellerDashboard() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['seller-stats'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');

      const [{ count: productCount }, { count: availableCount }, { data: items }] = await Promise.all([
        supabase.from('products').select('id', { count: 'exact', head: true }).eq('seller_id', user.id),
        supabase.from('products').select('id', { count: 'exact', head: true })
          .eq('seller_id', user.id).eq('status', 'available'),
        supabase.from('order_items')
          .select('quantity, unit_price, products!inner(seller_id)')
          .eq('products.seller_id', user.id),
      ]);

      const revenue = (items ?? []).reduce((s: number, it: any) => s + Number(it.unit_price) * it.quantity, 0);
      return {
        productCount: productCount ?? 0,
        availableCount: availableCount ?? 0,
        orderCount: items?.length ?? 0,
        revenue,
      };
    },
  });

  if (isLoading || !stats) return <div className="text-center py-8">Caricamento...</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Prodotti totali"   value={stats.productCount}    icon="📦" />
        <KpiCard label="In vendita"        value={stats.availableCount}  icon="✅" />
        <KpiCard label="Articoli venduti"  value={stats.orderCount}      icon="🛒" />
        <KpiCard label="Fatturato"         value={formatPrice(stats.revenue)} icon="💰" />
      </div>
      <div className="bg-white border rounded-lg p-6">
        <h2 className="font-bold mb-3">Azioni rapide</h2>
        <div className="flex flex-wrap gap-3">
          <Link href="/seller/products/new" className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded">➕ Aggiungi prodotto</Link>
          <Link href="/seller/orders" className="bg-white border hover:bg-gray-50 px-4 py-2 rounded">📦 Gestisci ordini</Link>
          <Link href="/seller/profile" className="bg-white border hover:bg-gray-50 px-4 py-2 rounded">🏪 Modifica negozio</Link>
        </div>
      </div>
    </div>
  );
}

const KpiCard = ({ label, value, icon }: { label: string; value: string | number; icon: string }) => (
  <div className="bg-white border rounded-lg p-5">
    <div className="text-3xl mb-2">{icon}</div>
    <div className="text-2xl font-bold text-gray-800">{value}</div>
    <div className="text-sm text-gray-500">{label}</div>
  </div>
);
```

### `app/seller/products/page.tsx`
```tsx
'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';

export default function SellerProductsPage() {
  const qc = useQueryClient();

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['seller-products'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase.from('products')
        .select('id, name, price, status, images, stock, categories(name)')
        .eq('seller_id', user.id).order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['seller-products'] }); toast.success('Prodotto eliminato'); },
    onError: (err: any) => toast.error(err.message),
  });

  const toggleStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const newStatus = status === 'available' ? 'sold' : 'available';
      const { error } = await supabase.from('products').update({ status: newStatus }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['seller-products'] }),
    onError: (err: any) => toast.error(err.message),
  });

  if (isLoading) return <div className="text-center py-8">Caricamento...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">I tuoi prodotti</h1>
        <Link href="/seller/products/new" className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded">
          ➕ Nuovo prodotto
        </Link>
      </div>

      {products.length === 0 ? (
        <div className="bg-white border rounded-lg p-12 text-center text-gray-500">
          Non hai ancora pubblicato prodotti.
        </div>
      ) : (
        <div className="bg-white border rounded-lg overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left p-3">Prodotto</th>
                <th className="text-left p-3">Categoria</th>
                <th className="text-left p-3">Prezzo</th>
                <th className="text-left p-3">Stock</th>
                <th className="text-left p-3">Stato</th>
                <th className="text-right p-3">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p: any) => (
                <tr key={p.id} className="border-t hover:bg-gray-50">
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      <div className="relative w-12 h-12 bg-gray-100 rounded shrink-0">
                        <Image src={p.images?.[0] ?? 'https://placehold.co/100x100/eee/aaa?text=?'}
                          alt={p.name} fill className="object-cover rounded" unoptimized />
                      </div>
                      <Link href={`/product/${p.id}`} className="font-semibold hover:text-indigo-600">{p.name}</Link>
                    </div>
                  </td>
                  <td className="p-3">{p.categories?.name ?? '—'}</td>
                  <td className="p-3 font-semibold">{formatPrice(Number(p.price))}</td>
                  <td className="p-3">{p.stock ?? 0}</td>
                  <td className="p-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                      p.status === 'available' ? 'bg-green-100 text-green-700' :
                      p.status === 'sold'      ? 'bg-gray-200 text-gray-700' :
                                                 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {p.status === 'available' ? 'In vendita' : p.status === 'sold' ? 'Esaurito' : 'In approvazione'}
                    </span>
                  </td>
                  <td className="p-3 text-right space-x-2 whitespace-nowrap">
                    <button onClick={() => toggleStatus.mutate({ id: p.id, status: p.status })} className="text-indigo-600 hover:underline">
                      {p.status === 'available' ? 'Disattiva' : 'Attiva'}
                    </button>
                    <button onClick={() => { if (confirm(`Eliminare "${p.name}"?`)) remove.mutate(p.id); }} className="text-red-600 hover:underline">
                      Elimina
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

### `app/seller/products/new/page.tsx`
```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import * as z from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';

const Schema = z.object({
  name:        z.string().min(3, 'Almeno 3 caratteri'),
  description: z.string().min(10, 'Almeno 10 caratteri'),
  price:       z.coerce.number().positive('Inserisci un prezzo valido'),
  stock:       z.coerce.number().int().min(0).default(0),
  category_id: z.string().min(1, 'Seleziona una categoria'),
});
type FormData = z.infer<typeof Schema>;

export default function NewProductPage() {
  const router = useRouter();
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const { data: categories = [] } = useQuery({
    queryKey: ['cats-form'],
    queryFn: async () => {
      const { data, error } = await supabase.from('categories').select('id, name').order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(Schema) });

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/*': [] },
    onDrop: async (files) => {
      setUploading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Non autenticato');
        const uploaded: string[] = [];
        for (const file of files) {
          const path = `${user.id}/${Date.now()}-${file.name}`;
          const { error } = await supabase.storage.from('products').upload(path, file);
          if (error) throw error;
          const { data } = supabase.storage.from('products').getPublicUrl(path);
          uploaded.push(data.publicUrl);
        }
        setImageUrls((prev) => [...prev, ...uploaded]);
        toast.success('Immagini caricate');
      } catch (err: any) { toast.error(err.message); }
      finally { setUploading(false); }
    },
  });

  const create = useMutation({
    mutationFn: async (form: FormData) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { error } = await supabase.from('products').insert({
        name: form.name, description: form.description, price: form.price, stock: form.stock,
        category_id: form.category_id, seller_id: user.id, images: imageUrls, status: 'available',
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Prodotto pubblicato!'); router.push('/seller/products'); },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Nuovo prodotto</h1>
      <form onSubmit={handleSubmit((d) => create.mutate(d))} className="bg-white border rounded-lg p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Nome prodotto</label>
          <input {...register('name')} className="w-full border p-2 rounded" placeholder="Es. Pomodori biologici" />
          {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Descrizione</label>
          <textarea {...register('description')} rows={4} className="w-full border p-2 rounded" />
          {errors.description && <p className="text-red-500 text-sm mt-1">{errors.description.message}</p>}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Prezzo (€)</label>
            <input type="number" step="0.01" {...register('price')} className="w-full border p-2 rounded" />
            {errors.price && <p className="text-red-500 text-sm mt-1">{errors.price.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Disponibilità</label>
            <input type="number" {...register('stock')} className="w-full border p-2 rounded" defaultValue={1} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Categoria</label>
          <select {...register('category_id')} className="w-full border p-2 rounded">
            <option value="">Seleziona...</option>
            {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {errors.category_id && <p className="text-red-500 text-sm mt-1">{errors.category_id.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Immagini</label>
          <div {...getRootProps()} className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            isDragActive ? 'border-indigo-400 bg-indigo-50' : 'border-gray-300 hover:border-indigo-400'}`}>
            <input {...getInputProps()} />
            {uploading ? <p className="text-gray-500">Caricamento...</p> :
              <p className="text-gray-500">Trascina qui le foto o clicca per selezionarle</p>}
          </div>
          {imageUrls.length > 0 && (
            <div className="grid grid-cols-4 gap-2 mt-3">
              {imageUrls.map((url, i) => (
                <div key={url} className="relative aspect-square">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="w-full h-full object-cover rounded" />
                  <button type="button" onClick={() => setImageUrls((u) => u.filter((_, j) => j !== i))}
                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 text-xs">×</button>
                </div>
              ))}
            </div>
          )}
        </div>
        <button type="submit" disabled={create.isPending}
          className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white py-3 rounded-lg font-semibold">
          {create.isPending ? 'Pubblicazione...' : 'Pubblica prodotto'}
        </button>
      </form>
    </div>
  );
}
```

### `app/seller/orders/page.tsx`
```tsx
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { formatPrice, formatDate } from '@/lib/format';

const statusOptions = ['PREPARATION', 'SHIPPED', 'DELIVERED'] as const;
const statusLabels: Record<string, string> = {
  PREPARATION: '📦 Preparazione', SHIPPED: '🚚 Spedito', DELIVERED: '✅ Consegnato',
};

export default function SellerOrdersPage() {
  const qc = useQueryClient();

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['seller-orders'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase.from('order_items').select(`
        id, quantity, unit_price,
        products!inner ( name, seller_id ),
        orders ( id, total_price, delivery_status, payment_status, created_at, user_id )
      `).eq('products.seller_id', user.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: string }) => {
      const { error } = await supabase.from('orders').update({ delivery_status: status }).eq('id', orderId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['seller-orders'] }); toast.success('Stato aggiornato'); },
    onError: (err: any) => toast.error(err.message),
  });

  if (isLoading) return <div className="text-center py-8">Caricamento...</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Ordini ricevuti</h1>
      {orders.length === 0 ? (
        <div className="bg-white border rounded-lg p-12 text-center text-gray-500">Non hai ancora ricevuto ordini.</div>
      ) : (
        <div className="bg-white border rounded-lg overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="p-3 text-left">Ordine</th>
                <th className="p-3 text-left">Data</th>
                <th className="p-3 text-left">Prodotto</th>
                <th className="p-3 text-left">Quantità</th>
                <th className="p-3 text-left">Importo</th>
                <th className="p-3 text-left">Stato consegna</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((it: any) => (
                <tr key={it.id} className="border-t">
                  <td className="p-3 font-mono text-xs">#{it.orders?.id?.slice(0, 8).toUpperCase()}</td>
                  <td className="p-3">{it.orders?.created_at ? formatDate(it.orders.created_at) : '—'}</td>
                  <td className="p-3">{it.products?.name}</td>
                  <td className="p-3">×{it.quantity}</td>
                  <td className="p-3 font-semibold">{formatPrice(Number(it.unit_price) * it.quantity)}</td>
                  <td className="p-3">
                    <select value={it.orders?.delivery_status ?? 'PREPARATION'}
                      onChange={(e) => updateStatus.mutate({ orderId: it.orders!.id, status: e.target.value })}
                      className="border rounded px-2 py-1 text-sm">
                      {statusOptions.map((s) => <option key={s} value={s}>{statusLabels[s]}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

### `app/seller/profile/page.tsx`
```tsx
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import VendorForm, { VendorFormData } from '@/components/VendorForm';
import { toast } from 'sonner';

export default function SellerProfilePage() {
  const qc = useQueryClient();

  const { data: profile, isLoading } = useQuery({
    queryKey: ['seller-profile'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      if (error) throw error;
      return data;
    },
  });

  const update = useMutation({
    mutationFn: async (form: VendorFormData) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { error } = await supabase.from('profiles').update({
        store_name:  form.storeName,
        store_lat:   form.storeLat,
        store_lng:   form.storeLng,
        store_phone: form.storePhone,
        role:        profile?.is_approved ? 'seller' : 'pending_approval',
      }).eq('id', user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['seller-profile'] }); toast.success('Profilo aggiornato!'); },
    onError: (err: any) => toast.error(err.message),
  });

  if (isLoading) return <div className="text-center py-8">Caricamento...</div>;

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-bold">Profilo negozio</h1>
      {profile?.is_approved ? (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-green-800">✅ Il tuo negozio è approvato e attivo</div>
      ) : profile?.role === 'pending_approval' ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-800">⏳ In attesa di approvazione dall'admin</div>
      ) : (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-blue-800">ℹ️ Compila i dati del negozio per richiedere l'approvazione</div>
      )}
      <div className="bg-white border rounded-lg p-6">
        <VendorForm defaultValues={{
            storeName:  profile?.store_name  ?? '',
            storeLat:   profile?.store_lat   ?? undefined,
            storeLng:   profile?.store_lng   ?? undefined,
            storePhone: profile?.store_phone ?? '',
          }}
          onSubmit={(d) => update.mutate(d)} isLoading={update.isPending} />
      </div>
    </div>
  );
}
```

### `migrations/001_create_tables.sql`
Schema base con `profiles`, `products`, `orders`, `order_items`, `reviews`, RLS, trigger `handle_new_user`. Vedi sezione successiva per `002` con le aggiunte.

```sql
CREATE TABLE public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role text CHECK (role IN ('seller', 'buyer', 'pending_approval')) DEFAULT 'buyer',
    is_approved boolean DEFAULT false,
    store_name text,
    store_lat double precision,
    store_lng double precision,
    store_phone text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE public.products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    description text,
    price numeric(10, 2) NOT NULL CHECK (price >= 0),
    images jsonb DEFAULT '[]',
    seller_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    status text CHECK (status IN ('available', 'sold', 'pending_approval')) DEFAULT 'pending_approval',
    created_at timestamptz DEFAULT now()
);

CREATE TABLE public.orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    total_price numeric(10, 2) NOT NULL CHECK (total_price >= 0),
    payment_status text CHECK (payment_status IN ('PAID', 'FAILED', 'PENDING')) DEFAULT 'PENDING',
    delivery_status text CHECK (delivery_status IN ('PREPARATION', 'SHIPPED', 'DELIVERED')) DEFAULT 'PREPARATION',
    created_at timestamptz DEFAULT now()
);

CREATE TABLE public.order_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
    quantity integer NOT NULL CHECK (quantity > 0),
    unit_price numeric(10, 2) NOT NULL
);

CREATE TABLE public.reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    rating numeric(2, 1) NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment text,
    created_at timestamptz DEFAULT now()
);

ALTER TABLE public.profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile"    ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile"  ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Profile is created on signup"        ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Anyone can view available products"  ON public.products FOR SELECT USING (status = 'available');
CREATE POLICY "Approved sellers can insert products" ON public.products FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_approved = true)
);
CREATE POLICY "Sellers can update their own products" ON public.products FOR UPDATE USING (seller_id = auth.uid());

CREATE POLICY "Users can view their own orders" ON public.orders FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can create orders"         ON public.orders FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Anyone can view reviews"               ON public.reviews FOR SELECT USING (true);
CREATE POLICY "Authenticated users can write reviews" ON public.reviews FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
    INSERT INTO public.profiles (id, role) VALUES (new.id, 'buyer');
    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
```

### `migrations/002_categories_and_extras.sql`
```sql
-- Categories
CREATE TABLE public.categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text UNIQUE NOT NULL,
    name text NOT NULL,
    parent_id uuid REFERENCES public.categories(id) ON DELETE CASCADE,
    icon text,
    created_at timestamptz DEFAULT now()
);
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view categories" ON public.categories FOR SELECT USING (true);

-- Estensione products + profiles
ALTER TABLE public.products
    ADD COLUMN category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
    ADD COLUMN stock integer DEFAULT 0 CHECK (stock >= 0);
ALTER TABLE public.profiles
    ADD COLUMN full_name text, ADD COLUMN phone text,
    ADD COLUMN address text,   ADD COLUMN city text,
    ADD COLUMN zip text;

-- Sellers: CRUD propri prodotti
CREATE POLICY "Sellers can view their own products"   ON public.products FOR SELECT USING (seller_id = auth.uid());
CREATE POLICY "Sellers can delete their own products" ON public.products FOR DELETE USING (seller_id = auth.uid());

-- Sellers: ordini relativi ai loro prodotti
CREATE POLICY "Sellers can view orders of their products" ON public.orders FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.order_items oi JOIN public.products p ON p.id = oi.product_id
            WHERE oi.order_id = orders.id AND p.seller_id = auth.uid())
);
CREATE POLICY "Sellers can update orders of their products" ON public.orders FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.order_items oi JOIN public.products p ON p.id = oi.product_id
            WHERE oi.order_id = orders.id AND p.seller_id = auth.uid())
);

-- order_items: buyer + seller
CREATE POLICY "Users can view their own order_items" ON public.order_items FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.orders WHERE id = order_items.order_id AND user_id = auth.uid())
);
CREATE POLICY "Users can insert their own order_items" ON public.order_items FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.orders WHERE id = order_items.order_id AND user_id = auth.uid())
);
CREATE POLICY "Sellers can view order_items of their products" ON public.order_items FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.products WHERE id = order_items.product_id AND seller_id = auth.uid())
);

-- Seed categorie principali
INSERT INTO public.categories (slug, name, icon) VALUES
    ('alimentari',    'Alimentari',     '🍎'),
    ('abbigliamento', 'Abbigliamento',  '👕'),
    ('casa',          'Casa & Cucina',  '🏠'),
    ('elettronica',   'Elettronica',    '💻'),
    ('libri',         'Libri',          '📚'),
    ('giardino',      'Giardino',       '🌱'),
    ('bellezza',      'Bellezza',       '💄'),
    ('sport',         'Sport',          '⚽');

-- Sottocategorie
INSERT INTO public.categories (slug, name, parent_id) SELECT 'frutta-verdura','Frutta e Verdura',id FROM public.categories WHERE slug='alimentari';
INSERT INTO public.categories (slug, name, parent_id) SELECT 'panificio',     'Panificio',       id FROM public.categories WHERE slug='alimentari';
INSERT INTO public.categories (slug, name, parent_id) SELECT 'salumeria',     'Salumeria',       id FROM public.categories WHERE slug='alimentari';
INSERT INTO public.categories (slug, name, parent_id) SELECT 'uomo',          'Uomo',            id FROM public.categories WHERE slug='abbigliamento';
INSERT INTO public.categories (slug, name, parent_id) SELECT 'donna',         'Donna',           id FROM public.categories WHERE slug='abbigliamento';
INSERT INTO public.categories (slug, name, parent_id) SELECT 'bambini',       'Bambini',         id FROM public.categories WHERE slug='abbigliamento';

-- Storage bucket per immagini prodotti
INSERT INTO storage.buckets (id, name, public) VALUES ('products', 'products', true) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Anyone can view product images" ON storage.objects FOR SELECT USING (bucket_id = 'products');
CREATE POLICY "Authenticated users can upload product images" ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'products' AND auth.role() = 'authenticated');
CREATE POLICY "Users can update their own product images" ON storage.objects FOR UPDATE
    USING (bucket_id = 'products' AND owner = auth.uid());
CREATE POLICY "Users can delete their own product images" ON storage.objects FOR DELETE
    USING (bucket_id = 'products' AND owner = auth.uid());
```

## 6. Convenzioni di codice

- **Lingua UI**: tutto in italiano (label, errori, toast, badge).
- **Path alias**: `@/*` mappato sulla root.
- **Strict TS** abilitato; `any` ammesso solo per Supabase response shape e errori `catch (err: any)`.
- **No commenti superflui**: nomi auto-esplicativi.
- **Dynamic params**: in Next 14 i `params` di pagine dinamiche sono `Promise<{...}>` e si srotolano con `use(params)` (lato client) — il prompt usa già questo pattern.
- **Carrello**: SOLO `localStorage` via `lib/cart.ts`. Mai DB. Mai context React.
- **Mutations**: usano sempre TanStack Query; al successo invalidano la queryKey rilevante e chiamano `toast.success`; in error chiamano `toast.error(err.message)`.
- **Immagini**: `next/image` con `unoptimized` perché si usa anche `placehold.co`; bucket `products` per upload reali.
- **Niente file extra**: non creare README, LICENSE, .editorconfig, husky, jest, eslint custom config.

## 7. Istruzioni step-by-step per Claude Code

Esegui in ordine, **senza** chiedere conferma tra uno step e l'altro:

1. Crea la struttura di cartelle elencata sopra.
2. Scrivi tutti i file con il contenuto **esatto** fornito.
3. Lancia `npm install`.
4. Crea il file `.env.local` come copia di `.env.example` (l'utente lo compilerà con le credenziali Supabase reali).
5. Stampa a video le istruzioni finali:
   - "Crea un progetto su https://supabase.com"
   - "Copia URL e anon key in `.env.local`"
   - "Apri la SQL Editor di Supabase ed esegui prima `migrations/001_create_tables.sql`, poi `migrations/002_categories_and_extras.sql`"
   - "Il secondo script crea anche il bucket Storage `products` per le immagini dei prodotti"
   - "Lancia `npm run dev` e apri http://localhost:3000"
   - "Per approvare il primo venditore: registra un utente normale, poi dalla dashboard Supabase apri la tabella `profiles` e imposta manualmente `is_approved=true` su quella riga. Quell'utente potrà ora accedere a `/admin` e approvare altri venditori."

Procedi adesso.
