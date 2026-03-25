import { Component, JSX, splitProps, Show } from 'solid-js';
import { cn } from '@/lib/utils';

interface BadgeProps extends JSX.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'error' | 'outline';
  size?: 'sm' | 'md';
}

const variantStyles = {
  default: 'bg-white/40 text-text-secondary border border-white/30',
  primary: 'bg-primary/10 text-primary border border-primary/20',
  success: 'bg-green-500/10 text-green-600 border border-green-500/20',
  warning: 'bg-yellow-500/10 text-yellow-600 border border-yellow-500/20',
  error: 'bg-red-500/10 text-red-600 border border-red-500/20',
  outline: 'bg-transparent border border-white/50 text-text-muted',
};

const sizeStyles = {
  sm: 'px-2 py-0.5 text-[10px]',
  md: 'px-2.5 py-1 text-xs',
};

export const Badge: Component<BadgeProps> = (props) => {
  const [local, rest] = splitProps(props, ['variant', 'size', 'class', 'children']);

  return (
    <span
      class={cn(
        'inline-flex items-center font-bold uppercase tracking-wider rounded-full',
        variantStyles[local.variant || 'default'],
        sizeStyles[local.size || 'md'],
        local.class
      )}
      {...rest}
    >
      {local.children}
    </span>
  );
};

// Notification Badge (red dot)
interface NotificationBadgeProps {
  show?: boolean;
  count?: number;
}

export const NotificationBadge: Component<NotificationBadgeProps> = (props) => {
  return (
    <Show when={props.show !== false}>
      <span class="absolute -top-0.5 -right-0.5 flex items-center justify-center">
        <Show
          when={props.count && props.count > 0}
          fallback={
            <span class="size-2 bg-primary rounded-full ring-2 ring-white/50" />
          }
        >
          <span class="min-w-[18px] h-[18px] px-1 bg-primary text-white text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-white/50">
            {props.count! > 99 ? '99+' : props.count}
          </span>
        </Show>
      </span>
    </Show>
  );
};
