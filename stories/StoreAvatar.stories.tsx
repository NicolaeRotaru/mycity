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

export const WithLogo: Story = {
  args: { logoUrl: 'https://placehold.co/200x200/C0492C/fff?text=PR' },
};

export const Small: Story = {
  args: { logoUrl: null, size: 'sm' },
};

export const Large: Story = {
  args: { logoUrl: null, size: 'lg' },
};

export const ExtraLarge: Story = {
  args: { logoUrl: 'https://placehold.co/300x300/4A7C59/fff?text=Bio', size: 'xl' },
};
