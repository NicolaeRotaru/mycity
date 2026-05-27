import type { Meta, StoryObj } from '@storybook/react';
import { ErrorState } from '@/components/ui/ErrorState';

const meta: Meta<typeof ErrorState> = {
  title: 'UI/ErrorState',
  component: ErrorState,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof ErrorState>;

export const Default: Story = {};

export const WithRetry: Story = {
  args: {
    retry: () => alert('Retry clicked'),
  },
};

export const WithBackLink: Story = {
  args: {
    title: 'Prodotto non trovato',
    description: 'Questo prodotto è stato rimosso dal venditore.',
    backHref: '/',
    backLabel: 'Torna alla home',
  },
};

export const Both: Story = {
  args: {
    title: 'Errore di connessione',
    description: 'Non siamo riusciti a caricare i dati. Controlla la connessione e riprova.',
    retry: () => alert('Retry clicked'),
    backHref: '/',
  },
};
