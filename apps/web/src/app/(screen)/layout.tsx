/**
 * Full-screen pages, shown on a TV or tablet people look at from across a room (the waiting-room
 * screen): no header, no footer, nothing to click away to.
 */
export default function ScreenLayout({ children }: LayoutProps<'/'>) {
  return (
    <main id="main" tabIndex={-1} className="focus:outline-none">
      {children}
    </main>
  );
}
