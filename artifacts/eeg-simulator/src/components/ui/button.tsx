import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

/**
 * Buttons in Apple's four styles: filled (the one main action), tinted (a secondary
 * action in the accent), gray (a neutral action) and plain (text only). `outline`
 * and `ghost` are kept as the names older call sites use, drawn as gray and plain.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] font-semibold transition-[background-color,opacity,transform] duration-150 active:scale-[0.98] active:opacity-80 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 select-none',
  {
    variants: {
      variant: {
        default: 'bg-ui-accent text-ui-on-accent hover:brightness-110',
        tinted: 'bg-ui-accent/15 text-ui-accent hover:bg-ui-accent/20',
        destructive: 'bg-ui-red/15 text-ui-red hover:bg-ui-red/20',
        outline: 'bg-ui-fill text-ui-text hover:bg-ui-fill-2',
        secondary: 'bg-ui-fill text-ui-text hover:bg-ui-fill-2',
        ghost: 'text-ui-accent hover:bg-ui-fill',
        link: 'text-ui-accent underline-offset-4 hover:underline',
      },
      size: {
        default: 'min-h-9 px-4 text-[13px] pointer-coarse:min-h-11 pointer-coarse:text-[15px]',
        sm: 'min-h-8 px-3 text-[12px] pointer-coarse:min-h-10 pointer-coarse:text-[14px]',
        lg: 'min-h-11 px-6 text-[15px] pointer-coarse:min-h-[50px] pointer-coarse:text-[17px]',
        icon: 'h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
