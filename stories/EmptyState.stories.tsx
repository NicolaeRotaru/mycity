import type { Meta, StoryObj } from '@storybook/react';
import { ShoppingCart, Package, Search, Heart } from 'lucide-react';
import EmptyState from '@/components/EmptyState';

const meta: Meta<typeof EmptyState> = {
  title: 'Components/EmptyState',
  component: EmptyState,
  parameters: { layout: 'padded' },
  argTypes: {
    variant: { control: 'select', options: ['default', 'compact'] },
  },
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

export const CartEmpty: Story = {
  args: {
    icon: ShoppingCart,
    title: 'Il carrello è vuoto',
    description: 'Aggiungi prodotti dai negozi della tua città.',
    ctaLabel: 'Esplora negozi',
    ctaHref: '/stores',
  },
};

export const NoOrders: Story = {
  args: {
    icon: Package,
    title: 'Nessun ordine ancora',
    description: 'Quando farai il primo ordine lo vedrai qui.',
    ctaLabel: 'Inizia a comprare',
    ctaHref: '/',
  },
};

export const NoSearchResults: Story = {
  args: {
    icon: Search,
    title: 'Nessun risultato',
    description: 'Prova con parole chiave diverse o esplora le categorie.',
  },
};

export const WithTwoCTAs: Story = {
  args: {
    icon: Heart,
    title: 'Nessun preferito',
    description: 'Salva i prodotti che ti piacciono per ritrovarli facilmente.',
    ctaLabel: 'Esplora',
    ctaHref: '/',
    secondaryLabel: 'Vedi offerte',
    secondaryHref: '/deals',
  },
};

export const Compact: Story = {
  args: {
    icon: Package,
    title: 'Niente qui',
    variant: 'compact',
  },
};
