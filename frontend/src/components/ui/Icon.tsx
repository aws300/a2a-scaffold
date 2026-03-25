import { Component, JSX, splitProps } from 'solid-js';
import { cn } from '@/lib/utils';

interface IconProps extends JSX.HTMLAttributes<HTMLSpanElement> {
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  filled?: boolean;
}

const sizeMap = {
  xs: 'text-[14px]',
  sm: 'text-[16px]',
  md: 'text-[20px]',
  lg: 'text-[24px]',
  xl: 'text-[28px]',
};

export const Icon: Component<IconProps> = (props) => {
  const [local, rest] = splitProps(props, ['name', 'size', 'filled', 'class']);

  return (
    <span
      class={cn(
        'material-symbols-outlined select-none',
        sizeMap[local.size || 'md'],
        local.filled && '[font-variation-settings:"FILL"_1]',
        local.class
      )}
      {...rest}
    >
      {local.name}
    </span>
  );
};
