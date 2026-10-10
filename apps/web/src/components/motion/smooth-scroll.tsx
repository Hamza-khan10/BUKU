'use client';

import { ReactLenis, useLenis } from 'lenis/react';
import { useEffect, type ReactNode } from 'react';

/**
 * While a dialog or menu holds the page still (Radix marks the body with
 * data-scroll-locked), smooth scrolling pauses too, so the page behind it
 * never moves.
 */
function PauseWhileLocked() {
  const lenis = useLenis();
  useEffect(() => {
    if (!lenis) return;
    const sync = () => (document.body.hasAttribute('data-scroll-locked') ? lenis.stop() : lenis.start());
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-scroll-locked'] });
    sync();
    return () => observer.disconnect();
  }, [lenis]);
  return null;
}

/**
 * Smooth wheel scrolling on desktop (Lenis, D-093). Touch stays native (it
 * already has momentum), keyboard and in-page links work as usual, anything
 * marked data-lenis-prevent (dialogs, menus, lists that scroll) scrolls on its
 * own, and it is off for people who ask for reduced motion.
 */
export function SmoothScroll({ children }: { children: ReactNode }) {
  return (
    <ReactLenis
      root
      options={{
        autoRaf: true,
        lerp: 0.11,
        anchors: true,
        allowNestedScroll: true,
        stopInertiaOnNavigate: true,
        respectReducedMotion: true,
      }}
    >
      <PauseWhileLocked />
      {children}
    </ReactLenis>
  );
}
