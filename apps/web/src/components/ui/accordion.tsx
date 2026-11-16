'use client';

import { Plus } from 'lucide-react';
import { Accordion as RadixAccordion } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Questions and answers that open in place (keyboard and screen readers handled by Radix): an open
 * list set between hairlines, no box around it. The question carries the weight; the answer reads
 * at a comfortable measure.
 */
export function Accordion({ className, ...props }: ComponentProps<typeof RadixAccordion.Root>) {
  return (
    <RadixAccordion.Root className={cn('divide-y divide-line border-y border-line', className)} {...props} />
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
        <RadixAccordion.Trigger
          className={cn(
            'group flex w-full items-center justify-between gap-6 rounded-sm py-5 text-left sm:py-6',
            'text-[1.05rem] leading-snug font-medium tracking-[-0.012em] text-ink sm:text-lg',
            'transition-colors duration-200 hover:text-brand-ink',
            'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus/20',
          )}
        >
          {question}
          {/* A plus that turns into a close mark: the state at a glance, where the eye ends. */}
          <span
            aria-hidden
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-full bg-sunken text-ink-2 ring-1 ring-line ring-inset',
              'transition-[background-color,color,rotate] duration-300 ease-(--ease-out) motion-reduce:transition-none',
              'group-hover:bg-brand-soft group-hover:text-brand-ink',
              'group-data-[state=open]:rotate-45 group-data-[state=open]:bg-brand group-data-[state=open]:text-on-brand group-data-[state=open]:ring-transparent',
            )}
          >
            <Plus className="size-4" strokeWidth={2.25} />
          </span>
        </RadixAccordion.Trigger>
      </RadixAccordion.Header>
      {/* Always in the page (search and answer engines read every answer, D-136); while closed it
          takes no room and is hidden from everyone. It opens by growing to its own height, with no
          overshoot, and at once for those who ask for less motion. */}
      <RadixAccordion.Content
        forceMount
        className={cn(
          'grid transition-[grid-template-rows,visibility] duration-300 ease-(--ease-out) motion-reduce:transition-none',
          'data-[state=closed]:invisible data-[state=closed]:grid-rows-[0fr] data-[state=open]:grid-rows-[1fr]',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="max-w-[62ch] pr-14 pb-6 leading-relaxed text-ink-2 [&_a]:font-medium [&_a]:text-brand-ink [&_a]:underline [&_a]:underline-offset-4 [&_p+p]:mt-3">
            {children}
          </div>
        </div>
      </RadixAccordion.Content>
    </RadixAccordion.Item>
  );
}
