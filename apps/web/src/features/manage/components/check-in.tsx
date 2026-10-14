'use client';

import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ScanLine } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { problemFrom, type Problem } from '@/features/auth/problems';
import { ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { normaliseCode, type Visit } from '../visits';
import { allVisitsKey, checkInByCode } from '../visits-api';

/**
 * Checking someone in by their receipt code (3.5b): typed (any case, with or without the dash),
 * or scanned from the QR on their phone where the browser can read QR codes. Scanning twice is
 * harmless; a code from another business is simply "not found".
 */
export function CodeCheckIn({
  businessId,
  large = false,
  scan = false,
}: {
  businessId: string;
  /** The check-in page's big version. */
  large?: boolean;
  /** Offer the camera (the check-in page only, where the camera is allowed). */
  scan?: boolean;
}) {
  const id = useId();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | undefined>();
  const [done, setDone] = useState<{ visit: Visit; already: boolean } | null>(null);
  const [scanning, setScanning] = useState(false);
  const canScan = scan && typeof window !== 'undefined' && 'BarcodeDetector' in window;

  const checkIn = async (typed: string) => {
    const normal = normaliseCode(typed);
    setDone(null);
    if (!normal) {
      setProblem({ title: 'That isn’t a booking code', detail: 'Booking codes look like BK-7KQ2MX.' });
      return;
    }
    setBusy(true);
    setProblem(undefined);
    const asked = Date.now();
    try {
      const visit = await checkInByCode(businessId, normal);
      const already = visit.checkedInAt !== null && Date.parse(visit.checkedInAt) < asked - 30_000;
      setDone({ visit, already });
      setCode('');
      await queryClient.invalidateQueries({ queryKey: allVisitsKey(businessId) });
    } catch (err) {
      setProblem(
        err instanceof ApiError && err.status === 404
          ? {
              title: `No booking ${normal} here`,
              detail: 'Check the code with them, or find them by name in your appointments.',
            }
          : problemFrom(err, 'Check-in didn’t work. Please try again.'),
      );
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void checkIn(code);
  };

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <label htmlFor={id} className={cn('font-semibold text-ink', large ? 'text-lg' : 'text-base')}>
          Booking code
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id={id}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="BK-7KQ2MX"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            enterKeyHint="go"
            maxLength={12}
            aria-describedby={`${id}-hint`}
            className={cn(
              'min-w-0 flex-1 rounded-full bg-surface px-5 font-mono tracking-[0.12em] text-ink uppercase shadow-soft ring-1 ring-line placeholder:tracking-[0.08em] placeholder:text-ink-3 placeholder:normal-case focus-visible:ring-2 focus-visible:ring-control focus-visible:outline-none',
              large ? 'h-14 text-xl' : 'h-11 text-base',
            )}
          />
          <Button type="submit" variant="primary" size={large ? 'lg' : 'md'} loading={busy}>
            Check in
          </Button>
          {canScan && (
            <Button type="button" size={large ? 'lg' : 'md'} onClick={() => setScanning(true)}>
              <ScanLine aria-hidden />
              Scan the QR code
            </Button>
          )}
        </div>
        <p id={`${id}-hint`} className="text-sm text-ink-3">
          It’s on their receipt, under the QR code.
        </p>
      </form>
      {problem && (
        <Alert tone="danger" title={problem.title}>
          {problem.detail}
        </Alert>
      )}
      {done && (
        <div role="status" className="flex items-start gap-3 rounded-xl bg-ok-soft p-4 text-ink">
          <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-ok" />
          <p className="text-[0.95rem]">
            <span className="font-semibold">
              {done.visit.customer.name} {done.already ? 'was already checked in' : 'is checked in'}
            </span>
            {' — '}
            {done.visit.service.name} at {done.visit.local.startTime}
            {done.visit.staff && <> with {done.visit.staff.displayName}</>}.
          </p>
        </div>
      )}
      {canScan && (
        <Scanner
          open={scanning}
          onOpenChange={setScanning}
          onCode={(value) => {
            setScanning(false);
            setCode(value);
            void checkIn(value);
          }}
        />
      )}
    </div>
  );
}

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
type DetectorClass = new (options: { formats: string[] }) => Detector;

/** The camera, looking for a receipt's QR code; it stops the moment it reads one, or on close. */
function Scanner({
  open,
  onOpenChange,
  onCode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCode: (code: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const Barcode = (window as unknown as { BarcodeDetector: DetectorClass }).BarcodeDetector;
    const detector = new Barcode({ formats: ['qr_code'] });
    const look = async () => {
      if (stopped || !video.current) return;
      try {
        const found = (await detector.detect(video.current))
          .map((c) => normaliseCode(c.rawValue))
          .find(Boolean);
        if (found) {
          stopped = true;
          onCode(found);
          return;
        }
      } catch {
        // A frame that couldn't be read: try the next one.
      }
      timer = window.setTimeout(() => void look(), 250);
    };
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(async (s) => {
        stream = s;
        if (stopped || !video.current) return;
        video.current.srcObject = s;
        await video.current.play();
        void look();
      })
      .catch(() =>
        setProblem('The camera isn’t available. Allow it for this site in your browser, or type the code.'),
      );
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, onCode]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setProblem(null);
        onOpenChange(next);
      }}
    >
      <DialogContent title="Scan the QR code" description="Hold their receipt in the frame.">
        {problem ? (
          <Alert tone="danger" title="No camera">
            {problem}
          </Alert>
        ) : (
          <video
            ref={video}
            muted
            playsInline
            aria-label="What the camera sees"
            className="aspect-square w-full rounded-xl bg-night object-cover"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
