'use client';

import type { SelectHTMLAttributes } from 'react';

/**
 * Native select used on KB screens instead of HeroUI Select.
 *
 * HeroUI's collection Select throws "Objects are not valid as a React child"
 * when items are built from mixed sentinel keys (`__all__` / `__none__`) and
 * loaded category ids. A native control has none of that machinery and is
 * enough for a filter/category picker.
 */
export function NativeSelect({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`border-default-200 bg-content1 text-foreground h-8 rounded-medium border px-2 text-sm ${className}`}
      {...props}
    />
  );
}
