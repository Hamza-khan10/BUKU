import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Join class names; later Tailwind classes win over earlier ones ("p-2 p-4" → "p-4"). */
export function cn(...classes: ClassValue[]): string {
  return twMerge(clsx(classes));
}
