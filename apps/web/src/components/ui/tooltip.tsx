'use client';

import { Tooltip as RadixTooltip } from 'radix-ui';
import type { ReactNode } from 'react';

/**
 * A short explanation on hover and keyboard focus. Never the only place
 * important information lives (touch screens can't hover).
 */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={300}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            sideOffset={6}
            className="z-50 max-w-64 rounded-sm bg-ink px-2.5 py-1.5 text-xs text-canvas shadow-lift animate-rise"
          >
            {content}
            <RadixTooltip.Arrow className="fill-ink" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
