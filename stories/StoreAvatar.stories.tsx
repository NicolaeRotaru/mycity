import type { Meta, StoryObj } from '@storybook/react';
import StoreAvatar from '@/components/StoreAvatar';

const meta: Meta<typeof StoreAvatar> = {
  title: 'Components/StoreAvatar',
  component: StoreAvatar,
  parameters: { layout: 'centered' },
  argTypes: {
    size: { control: 'select', options: ['sm', 'md', 'lg', 'xl'] },
  },
  args: { storeName: 'Panificio Rossi', size: 'md' },
};

export default meta;
type Story = StoryObj<typeof StoreAvatar>;

export const FallbackEmoji: Story = {
  args: { logoUrl: null },
};

// 27/11/2026 — I loghi venivano da placehold.co, un sito di terzi: la storia dipendeva dalla sua rete
// e il sito non lo usa piu' per i loghi. Ora sono immagini nostre, in public/ (Storybook la serve:
// staticDirs in .storybook/main.ts), come il segnaposto delle foto (lib/foto-mancante.ts).
export const WithLogo: Story = {
  args: { logoUrl: '/icon-192.svg' },
};

export const Small: Story = {
  args: { logoUrl: null, size: 'sm' },
};

export const Large: Story = {
  args: { logoUrl: null, size: 'lg' },
};

export const ExtraLarge: Story = {
  args: { logoUrl: '/icon-512.svg', size: 'xl' },
};
