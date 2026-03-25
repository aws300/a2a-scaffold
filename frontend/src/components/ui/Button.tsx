import { Component, JSX, splitProps, Show } from 'solid-js';
import { cn } from '@/lib/utils';
import { Icon } from './Icon';

interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline' | 'glass' | 'danger';
  size?: 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm' | 'icon-lg';
  loading?: boolean;
  icon?: string;
  iconPosition?: 'left' | 'right';
}

const variantStyles = {
  primary: 'bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/30 hover:shadow-primary/40',
  secondary: 'bg-white/60 hover:bg-white/80 text-text-primary border border-white/50 shadow-sm',
  ghost: 'hover:bg-white/40 text-text-muted hover:text-text-primary',
  outline: 'border border-primary/30 text-primary hover:bg-primary/10',
  glass: 'bg-white/40 hover:bg-white/60 backdrop-blur-[12px] border border-white/50 text-text-secondary hover:text-text-primary',
  danger: 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/30 hover:shadow-red-500/40',
};

const sizeStyles = {
  sm: 'px-3 py-1.5 text-sm gap-1.5',
  md: 'px-4 py-2.5 text-sm gap-2',
  lg: 'px-6 py-3 text-base gap-2.5',
  icon: 'size-10',
  'icon-sm': 'size-8',
  'icon-lg': 'size-12',
};

export const Button: Component<ButtonProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'variant',
    'size',
    'loading',
    'icon',
    'iconPosition',
    'class',
    'children',
    'disabled',
  ]);

  const isIconOnly = () => 
    local.size === 'icon' || local.size === 'icon-sm' || local.size === 'icon-lg';

  return (
    <button
      class={cn(
        'inline-flex items-center justify-center font-medium rounded-full transition-all duration-200',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
        'disabled:opacity-50 disabled:pointer-events-none',
        'active:scale-95',
        variantStyles[local.variant || 'primary'],
        sizeStyles[local.size || 'md'],
        isIconOnly() && 'rounded-full',
        local.class
      )}
      disabled={local.disabled || local.loading}
      {...rest}
    >
      <Show when={local.loading}>
        <Icon name="progress_activity" class="animate-spin" size="sm" />
      </Show>
      <Show when={!local.loading && local.icon && local.iconPosition !== 'right'}>
        <Icon name={local.icon!} size="sm" />
      </Show>
      <Show when={!isIconOnly()}>
        {local.children}
      </Show>
      <Show when={isIconOnly() && local.icon && !local.loading}>
        <Icon name={local.icon!} size={local.size === 'icon-sm' ? 'sm' : 'md'} />
      </Show>
      <Show when={!local.loading && local.icon && local.iconPosition === 'right'}>
        <Icon name={local.icon!} size="sm" />
      </Show>
    </button>
  );
};

// Icon Button Shorthand
interface IconButtonProps extends Omit<ButtonProps, 'size'> {
  size?: 'sm' | 'md' | 'lg';
}

export const IconButton: Component<IconButtonProps> = (props) => {
  const sizeMap = {
    sm: 'icon-sm' as const,
    md: 'icon' as const,
    lg: 'icon-lg' as const,
  };

  return (
    <Button
      {...props}
      size={sizeMap[props.size || 'md']}
      variant={props.variant || 'ghost'}
    />
  );
};
