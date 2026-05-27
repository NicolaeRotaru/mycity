import type { Meta, StoryObj } from '@storybook/react';
import { LoadingState } from '@/components/ui/LoadingState';

const meta: Meta<typeof LoadingState> = {
  title: 'UI/LoadingState',
  component: LoadingState,
  parameters: { layout: 'padded' },
  argTypes: {
    variant: { control: 'select', options: ['spinner', 'skeleton', 'inline'] },
    rows: { control: { type: 'number', min: 1, max: 10 } },
    message: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof LoadingState>;

export const Spinner: Story = {
  args: { variant: 'spinner' },
};

export const Skeleton: Story = {
  args: { variant: 'skeleton', rows: 4 },
};

export const Inline: Story = {
  args: { variant: 'inline' },
};

export const CustomMessage: Story = {
  args: { variant: 'spinner', message: 'Connessione al server…' },
};
