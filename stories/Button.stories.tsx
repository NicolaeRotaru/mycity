import type { Meta, StoryObj } from '@storybook/react';
import { Trash2, Check, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  parameters: { layout: 'centered' },
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'ghost', 'danger', 'success'],
    },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    shape: { control: 'select', options: ['rounded', 'pill'] },
    loading: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
  args: {
    children: 'Click me',
    variant: 'primary',
    size: 'md',
    shape: 'rounded',
    loading: false,
    disabled: false,
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = {};

export const Secondary: Story = {
  args: { variant: 'secondary', children: 'Annulla' },
};

export const Ghost: Story = {
  args: { variant: 'ghost', children: 'Skip' },
};

export const Danger: Story = {
  args: { variant: 'danger', children: 'Elimina', icon: Trash2 },
};

export const Success: Story = {
  args: { variant: 'success', children: 'Confermato', icon: Check },
};

export const Loading: Story = {
  args: { loading: true, children: 'Salvataggio…' },
};

export const Pill: Story = {
  args: { shape: 'pill', children: 'Pill shape' },
};

export const Small: Story = {
  args: { size: 'sm', children: 'Small' },
};

export const Large: Story = {
  args: { size: 'lg', children: 'Continua', iconRight: ArrowRight },
};

export const Disabled: Story = {
  args: { disabled: true, children: 'Disabilitato' },
};
