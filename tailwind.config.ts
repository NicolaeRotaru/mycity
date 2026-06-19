import type { Config } from 'tailwindcss';

/**
 * MyCity Design System — "Mediterranean Modern"
 *
 * Palette ispirata ai colori della cucina/mercato italiano:
 *  - terracotta (primary): tegole, cotto, terra dei portici
 *  - cream (background): muri intonacati, pane, lino
 *  - mustard (accent): saffron, zafferano, ocra
 *  - olive (success): verde dei colli piacentini
 *  - charcoal (text): inchiostro tipografico
 *
 * Tutta scelta per evocare "caldo, locale, autentico" invece del freddo
 * "SaaS B2B" della palette indigo/grey precedente.
 */
export default {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  // Le dashboard admin (StatCard, /admin/activity) compongono classi colore in
  // modo dinamico (`text-${color}-600`): il JIT non le rileva, quindi le mettiamo
  // qui in safelist per garantirne il render.
  safelist: [
    {
      pattern:
        /(bg|text|border)-(sky|violet|emerald|amber|indigo|rose|slate|pink|blue)-(100|200|600|700)/,
    },
  ],
  theme: {
    extend: {
      colors: {
        // Tonalità primaria: terracotta calda (era indigo)
        primary: {
          50:  '#FDF4F1',
          100: '#FAE3DC',
          200: '#F5C5B6',
          300: '#EE9F86',
          400: '#E47A5A',
          500: '#D55F3F',
          600: '#C0492C', // primary brand
          700: '#A03B25',
          800: '#7F2F1F',
          900: '#5C211A',
          950: '#321009',
        },
        // Accent mustard (CTA energetici, badge)
        accent: {
          50:  '#FEF8EC',
          100: '#FDECC8',
          200: '#FBD891',
          300: '#F4BC53',
          400: '#EFA830',
          500: '#E8A33D', // accent brand
          600: '#C4801F',
          700: '#9D621C',
          800: '#7F4F1E',
          900: '#69411C',
        },
        // Olive (status positivi, success, "fresco")
        olive: {
          50:  '#F6F8F1',
          100: '#E9EEDE',
          200: '#D3DCBE',
          300: '#B0C195',
          400: '#8FA672',
          500: '#7C8B5A',
          600: '#5A7C42', // success brand
          700: '#456236',
          800: '#384E2C',
          900: '#2E4127',
        },
        // Cream / sand (background)
        cream: {
          50:  '#FEFCF8',
          100: '#FBF7F0',  // page background
          200: '#F5EDD9',
          300: '#EEDFBA',
          400: '#E6CC95',
          500: '#D9B36F',
        },
        // Surface: base neutra/bianca per le pagine del funnel d'acquisto
        // (Home / Prodotto / Checkout). Grigi caldissimi che convivono con la
        // terracotta senza il "giallo" del cream, così le FOTO risaltano.
        // NON sostituisce cream globalmente: applicato chirurgicamente.
        surface: {
          0:   '#FFFFFF',
          50:  '#FAFAF9',
          100: '#F5F5F4',
          200: '#EAE8E4',
          300: '#D9D6D1',
        },
        // Charcoal (text)
        ink: {
          50:  '#F5F5F4',
          100: '#E7E5E4',
          200: '#D6D3D1',
          300: '#A8A29E',
          400: '#78716C',
          500: '#57534E',
          600: '#44403C',
          700: '#3C3835',
          800: '#2C2A28', // body text
          900: '#1C1A18', // headlines
        },
        // Secondary: burgundy/vino — sister color del primary terracotta,
        // NON la rose Tailwind default (era anti-pattern Mediterranean).
        secondary: {
          50:  '#FDF2F2',
          100: '#FCE0E0',
          200: '#F8C0BF',
          300: '#F09593',
          400: '#E66663',
          500: '#D63E3B',
          600: '#B82A28', // secondary brand
          700: '#962220',
          800: '#7A1F1D',
          900: '#651C1A',
        },
      },
      // Z-index hierarchy esplicita per evitare collisioni.
      // Esperti: SRE: "Stack accidentale è source di bug pesanti.
      // Ogni layer ha un range, ogni range è documentato."
      zIndex: {
        'base':        '0',       // contenuto normale
        'dropdown':    '10',      // dropdown menu interno
        'sticky':      '20',      // navbar, sticky header
        'sidebar':     '25',
        'mobile-nav':  '30',      // MobileTabBar fisso bottom
        'banner':      '35',      // PWAInstallBanner, WelcomeCreditBanner
        'overlay':     '40',      // SOS button, FAB
        'modal':       '50',      // Modal portal
        'toast':       '60',      // toast notifications
        'tour':        '70',      // BuyerOnboardingTour
        'skip-link':   '100',     // skip link focus
      },
      fontFamily: {
        // Inter caricato via next/font (--font-inter su <html>); allinea le
        // utility font-sans alla face realmente caricata.
        sans: ['var(--font-inter)', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
      },
      fontSize: {
        // Step micro mancante dalla ramp Tailwind (design --text-2xs).
        '2xs': '0.625rem',
      },
      letterSpacing: {
        // Tracking editoriale del design (additivi, nessun override).
        display: '-0.01em',
        editorial: '-0.015em',
        label: '0.04em',
      },
      borderRadius: {
        // Bordi un filo più morbidi (era 0.5rem default)
        sm: '0.375rem',
        DEFAULT: '0.5rem',
        lg: '0.75rem',
        xl: '1rem',
        '2xl': '1.25rem',
      },
      boxShadow: {
        // Shadow tinte calde (rgba terracotta), non grigie neutre
        'warm-sm':  '0 1px 2px 0 rgba(192, 73, 44, 0.05)',
        'warm':     '0 4px 12px -2px rgba(192, 73, 44, 0.08), 0 2px 4px -1px rgba(192, 73, 44, 0.04)',
        'warm-lg':  '0 12px 32px -8px rgba(192, 73, 44, 0.15), 0 4px 8px -2px rgba(192, 73, 44, 0.06)',
        'warm-xl':  '0 24px 48px -12px rgba(192, 73, 44, 0.22)',
        // Ombre neutre per il canvas bianco/surface (le warm-* su bianco puro
        // risultano "fangose"): inchiostro tenue invece di terracotta.
        'sm-neutral': '0 1px 2px 0 rgba(28, 26, 24, 0.06)',
        'card':       '0 1px 3px rgba(28, 26, 24, 0.08), 0 4px 12px -4px rgba(28, 26, 24, 0.10)',
      },
      animation: {
        // Micro-interazioni
        'heart-beat':  'heartBeat 0.6s ease-in-out',
        'confetti':    'confetti 1s ease-out',
        'shimmer':     'shimmer 2s linear infinite',
        'pulse-soft':  'pulseSoft 2.5s ease-in-out infinite',
        'slide-up':    'slideUp 260ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-down':  'slideDown 260ms cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in':     'fadeIn 200ms ease-out',
        'pop-in':      'popIn 240ms cubic-bezier(0.16, 1, 0.3, 1)',
        'progress-fill': 'progressFill 600ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        heartBeat: {
          '0%, 100%':  { transform: 'scale(1)' },
          '30%':       { transform: 'scale(1.4)' },
          '60%':       { transform: 'scale(0.95)' },
        },
        confetti: {
          '0%':   { transform: 'translateY(0) rotate(0)', opacity: '1' },
          '100%': { transform: 'translateY(-120px) rotate(720deg)', opacity: '0' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-1000px 0' },
          '100%': { backgroundPosition: '1000px 0' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.6' },
        },
        slideUp: {
          from: { transform: 'translateY(100%)' },
          to:   { transform: 'translateY(0)' },
        },
        slideDown: {
          from: { transform: 'translateY(-100%)' },
          to:   { transform: 'translateY(0)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        popIn: {
          from: { opacity: '0', transform: 'scale(0.92) translateY(8px)' },
          to:   { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        progressFill: {
          from: { width: '0%' },
        },
      },
    },
  },
  plugins: [require('tailwind-scrollbar-hide')],
} satisfies Config;
