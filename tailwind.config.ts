import type { Config } from 'tailwindcss';
import colors from 'tailwindcss/colors';

export default {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: colors.indigo,
        secondary: colors.pink,
      },
    },
  },
  plugins: [],
} satisfies Config;
