import * as React from 'react'
import { cn } from '../../lib/utils'

export const Checkbox = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="checkbox"
    className={cn(
      'h-4 w-4 rounded border-input text-primary focus:ring-ring focus:ring-offset-0',
      className
    )}
    {...props}
  />
))
Checkbox.displayName = 'Checkbox'
