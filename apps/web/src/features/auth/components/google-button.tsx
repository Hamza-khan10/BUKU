import { GoogleMark } from '@/components/brand/google-mark';
import { buttonStyles } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/**
 * "Continue with Google": a plain link to the web server's start of the
 * sign-in (a full page visit, not an in-app navigation — the server sends
 * the browser on to Google). No Google script runs on our pages (D-090).
 */
export function GoogleButton({
  next,
  restore = false,
  label = 'Continue with Google',
}: {
  next: string;
  /** Restore an account scheduled for deletion, as part of this sign-in. */
  restore?: boolean;
  label?: string;
}) {
  const params = new URLSearchParams();
  if (next !== '/') params.set('next', next);
  if (restore) params.set('restore', '1');
  const qs = params.toString();
  const href = `/api/auth/google/start${qs ? `?${qs}` : ''}`;
  return (
    <a
      href={href}
      // Less room at its sides on a narrow phone, so "Continue with Google" stays on one line down
      // to 320 px; a longer label may still wrap instead of spilling out of its box.
      className={cn(
        buttonStyles({ variant: 'secondary', size: 'lg', block: true }),
        'h-auto min-h-13 px-4 py-3 text-center whitespace-normal sm:px-7',
      )}
    >
      <GoogleMark className="size-5" />
      {label}
    </a>
  );
}
