import * as React from 'react';
import * as SwitchPrimitives from '@radix-ui/react-switch';
import { cn } from '@/lib/utils';

/** An iOS switch: system green when on; full size (51×31) on touch screens, smaller with a mouse. */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      'peer relative inline-flex shrink-0 cursor-pointer items-center rounded-full p-[2px] transition-colors duration-200',
      'h-[22px] w-[38px] pointer-coarse:h-[31px] pointer-coarse:w-[51px]',
      'data-[state=checked]:bg-ui-switch data-[state=unchecked]:bg-ui-fill-2',
      'disabled:cursor-not-allowed disabled:opacity-40',
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        'pointer-events-none block rounded-full bg-white shadow-[0_2px_5px_rgba(0,0,0,0.22),0_0_1px_rgba(0,0,0,0.25)] ring-0 transition-transform duration-200',
        'h-[18px] w-[18px] data-[state=checked]:translate-x-[16px]',
        'pointer-coarse:h-[27px] pointer-coarse:w-[27px] pointer-coarse:data-[state=checked]:translate-x-[20px]',
        'data-[state=unchecked]:translate-x-0',
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
