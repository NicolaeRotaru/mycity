import type { Meta, StoryObj } from '@storybook/react';
import { OrderStatusBadge } from '@/components/ui/OrderStatusBadge';

const meta: Meta<typeof OrderStatusBadge> = {
  title: 'UI/OrderStatusBadge',
  component: OrderStatusBadge,
  parameters: { layout: 'centered' },
  argTypes: {
    status: {
      control: 'select',
      options: ['NEW', 'ACCEPTED', 'READY', 'ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELED'],
    },
    size: { control: 'select', options: ['sm', 'md'] },
    variant: { control: 'select', options: ['pill', 'inline', 'icon-only'] },
  },
  args: { status: 'NEW', size: 'md', variant: 'pill' },
};

export default meta;
type Story = StoryObj<typeof OrderStatusBadge>;

export const New: Story = { args: { status: 'NEW' } };
export const Accepted: Story = { args: { status: 'ACCEPTED' } };
export const Ready: Story = { args: { status: 'READY' } };
export const OutForDelivery: Story = { args: { status: 'OUT_FOR_DELIVERY' } };
export const Delivered: Story = { args: { status: 'DELIVERED' } };
export const Canceled: Story = { args: { status: 'CANCELED' } };

export const Small: Story = { args: { status: 'OUT_FOR_DELIVERY', size: 'sm' } };
export const Inline: Story = { args: { status: 'READY', variant: 'inline' } };
export const IconOnly: Story = { args: { status: 'DELIVERED', variant: 'icon-only' } };
