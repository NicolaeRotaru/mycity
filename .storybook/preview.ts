import type { Preview } from '@storybook/react';
import '../app/globals.css';
import { NextIntlClientProvider } from 'next-intl';
import itMessages from '../messages/it.json';
import React from 'react';

/**
 * Storybook preview config.
 *
 * Wrappa ogni story con NextIntlClientProvider (default locale 'it')
 * cosi' i componenti che usano useTranslations() funzionano in isolamento.
 *
 * globals.css carica le custom properties (cream, ink, primary, accent, ecc.)
 * + Tailwind base.
 */

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: 'cream',
      values: [
        { name: 'cream', value: '#FAF6EE' },
        { name: 'white', value: '#FFFFFF' },
        { name: 'ink', value: '#1F1B16' },
      ],
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
  decorators: [
    (Story) =>
      React.createElement(
        NextIntlClientProvider,
        { locale: 'it', messages: itMessages },
        React.createElement(Story),
      ),
  ],
};

export default preview;
