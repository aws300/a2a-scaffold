import { Component, JSX, Show, splitProps } from 'solid-js';
import { cn } from '@/lib/utils';

interface CardProps extends JSX.HTMLAttributes<HTMLDivElement> {
  variant?: 'glass' | 'solid' | 'outline';
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const variantStyles = {
  glass: 'glass-panel',
  solid: 'bg-white shadow-md',
  outline: 'bg-transparent border border-white/50',
};

const paddingStyles = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

export const Card: Component<CardProps> = (props) => {
  const [local, rest] = splitProps(props, ['variant', 'padding', 'class', 'children']);

  return (
    <div
      class={cn(
        'rounded-3xl',
        variantStyles[local.variant || 'glass'],
        paddingStyles[local.padding || 'md'],
        local.class
      )}
      {...rest}
    >
      {local.children}
    </div>
  );
};

interface CardHeaderProps extends JSX.HTMLAttributes<HTMLDivElement> {
  title: string;
  subtitle?: string;
  action?: JSX.Element;
}

export const CardHeader: Component<CardHeaderProps> = (props) => {
  const [local, rest] = splitProps(props, ['title', 'subtitle', 'action', 'class']);

  return (
    <div
      class={cn('flex items-center justify-between mb-4', local.class)}
      {...rest}
    >
      <div>
        <h3 class="text-text-primary font-semibold text-lg">{local.title}</h3>
        <Show when={local.subtitle}>
          <p class="text-text-muted text-sm mt-0.5">{local.subtitle}</p>
        </Show>
      </div>
      <Show when={local.action}>
        {local.action}
      </Show>
    </div>
  );
};
