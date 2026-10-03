'use client';

import { ChevronDown } from 'lucide-react';
import { Accordion as RadixAccordion } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Questions and answers that open in place (keyboard and screen readers handled by Radix). */
export function Accordion({ className, ...props }: ComponentProps<typeof RadixAccordion.Root>) {
  return (
    <RadixAccordion.Root
      className={cn('divide-y divide-line rounded-lg border border-line bg-surface', className)}
      {...props}
    />
  );
}

export function AccordionItem({
  value,
  question,
  children,
}: {
  value: string;
  question: string;
  children: ReactNode;
}) {
  return (
    <RadixAccordion.Item value={value} id={value} className="scroll-mt-24">
      <RadixAccordion.Header>
        <RadixAccordion.Trigger className="group flex min-h-14 w-full items-center justify-between gap-4 px-5 py-3 text-left font-medium text-ink hover:bg-sunken/60">
          {question}
          <ChevronDown
            className="size-5 shrink-0 text-ink-3 transition-transform duration-200 group-data-[state=open]:rotate-180"
            aria-hidden
          />
        </RadixAccordion.Trigger>
      </RadixAccordion.Header>
      <RadixAccordion.Content className="px-5 pb-5 text-ink-2 [&_a]:font-medium [&_a]:text-brand-ink [&_a]:underline [&_a]:underline-offset-4 [&_p+p]:mt-3">
        {children}
      </RadixAccordion.Content>
    </RadixAccordion.Item>
  );
}
