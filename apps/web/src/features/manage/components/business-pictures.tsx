'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, ImageUp, Star, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CleanTextInput } from '@/components/ui/clean-text';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { toast } from '@/components/ui/toaster';
import { problemFrom } from '@/features/auth/problems';
import { CategoryIcon } from '@/features/categories/icons';
import { fileSize, MAX_PICTURE_BYTES, pictureProblem, PICTURE_TYPES } from '@/features/settings/picture';
import {
  makeCover,
  managedKey,
  MAX_PHOTOS,
  MINE_KEY,
  removeLogo,
  removePhoto,
  uploadLogo,
  uploadPhoto,
  type BusinessPhoto,
  type ManagedBusiness,
} from '../api';

/**
 * How a business looks on BUKU: its logo (in lists and at the top of its page) and its photos,
 * the first of them the cover. Each picture is checked here first, sent straight to storage,
 * then cleaned by the API (turned upright, no location or camera details) before anyone sees it.
 * Only the business's own pictures, never stock ones; a photo is described for people who can't
 * see it.
 */
export function BusinessPictures({ business }: { business: ManagedBusiness }) {
  return (
    <div className="flex flex-col gap-8">
      <LogoPicker business={business} />
      <PhotoGallery business={business} />
      <p className="text-sm text-ink-3">
        JPEG, PNG or WebP, up to {fileSize(MAX_PICTURE_BYTES)} each. Location and camera details hidden in
        pictures are removed before they’re shown.
      </p>
    </div>
  );
}

/** Keep what the page shows in step with what was just saved. */
function useSaved(id: string) {
  const queryClient = useQueryClient();
  return (change: Partial<Pick<ManagedBusiness, 'logoUrl' | 'photos'>>) => {
    queryClient.setQueryData<ManagedBusiness>(managedKey(id), (old) => (old ? { ...old, ...change } : old));
    void queryClient.invalidateQueries({ queryKey: MINE_KEY });
  };
}

function LogoPicker({ business }: { business: ManagedBusiness }) {
  const saved = useSaved(business.id);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const choose = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    const wrong = pictureProblem(file);
    setProblem(wrong);
    if (wrong) return;
    setBusy(true);
    try {
      saved({ logoUrl: (await uploadLogo(business.id, file, file.type)).logoUrl });
      toast.success('Your logo is saved.');
    } catch (err) {
      setProblem(problemFrom(err, 'The logo couldn’t be saved. Please try again.').title);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await removeLogo(business.id);
      saved({ logoUrl: null });
      setConfirm(false);
      toast('The logo is removed.');
    } catch (err) {
      setProblem(problemFrom(err, 'Removing it didn’t work. Please try again.').title);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="logo-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-4 sm:gap-5">
        <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-brand-soft text-brand-ink shadow-soft ring-1 ring-line">
          {business.logoUrl ? (
            <img src={business.logoUrl} alt={`${business.name}’s logo`} className="size-full object-cover" />
          ) : (
            <CategoryIcon slug={business.category.slug} className="size-8" />
          )}
        </span>
        <div className="flex min-w-0 flex-1 basis-44 flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h3 id="logo-title" className="font-semibold text-ink">
              Logo
            </h3>
            <p className="text-sm text-ink-3">
              Next to your name in lists and on your page. A square works best.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button loading={busy} onClick={() => input.current?.click()}>
              {!busy && <ImageUp aria-hidden />}
              {business.logoUrl ? 'Choose a new logo' : 'Choose a logo'}
            </Button>
            {business.logoUrl && !busy && (
              <Button variant="ghost" onClick={() => setConfirm(true)}>
                <Trash2 aria-hidden /> Remove
              </Button>
            )}
          </div>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept={PICTURE_TYPES.join(',')}
        aria-label="Logo file"
        className="hidden"
        onChange={(e) => void choose(e.target.files?.[0])}
      />
      {problem && <Alert tone="danger" title={problem} />}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent
          title="Remove the logo?"
          description="Your page shows the kind of business instead, until you choose another."
        >
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button variant="secondary">Keep it</Button>
            </DialogClose>
            <Button variant="danger" loading={busy} onClick={() => void remove()}>
              Remove logo
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function PhotoGallery({ business }: { business: ManagedBusiness }) {
  const saved = useSaved(business.id);
  const input = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<File | null>(null);
  const [alt, setAlt] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [removing, setRemoving] = useState<BusinessPhoto | null>(null);
  const photos = business.photos;
  const full = photos.length >= MAX_PHOTOS;

  const choose = (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    const wrong = pictureProblem(file);
    setProblem(wrong);
    setChosen(wrong ? null : file);
    setAlt('');
  };

  const run = async (work: () => Promise<BusinessPhoto[]>, done: string, fallback: string) => {
    setBusy(true);
    setProblem(null);
    try {
      saved({ photos: await work() });
      toast.success(done);
      return true;
    } catch (err) {
      setProblem(problemFrom(err, fallback).title);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!chosen) return;
    const ok = await run(
      () => uploadPhoto(business.id, chosen, chosen.type, alt.trim() || undefined),
      photos.length === 0 ? 'Your cover photo is saved.' : 'The photo is added.',
      'The photo couldn’t be added. Please try again.',
    );
    if (ok) setChosen(null);
  };

  return (
    <section aria-labelledby="photos-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h3 id="photos-title" className="font-semibold text-ink">
          Photos
        </h3>
        <p className="text-sm text-ink-3">
          The first is the cover, across the top of your page. Your place and your work; people only with
          their agreement.
        </p>
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photos.map((photo, i) => (
          <li key={photo.id} className="flex flex-col gap-2">
            <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-sunken ring-1 ring-line">
              <img
                src={photo.url}
                alt={photo.altText ?? `Photo ${i + 1} of ${business.name}`}
                className="size-full object-cover"
                loading="lazy"
              />
              {photo.isPrimary && (
                <Badge tone="brand" className="absolute top-2 left-2 shadow-soft">
                  <Star aria-hidden /> Cover
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {!photo.isPrimary && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => makeCover(business.id, photo.id),
                      'That photo is the cover now.',
                      'The cover couldn’t be changed. Please try again.',
                    )
                  }
                  className="min-h-9 text-sm font-medium text-brand-ink underline-offset-4 hover:underline disabled:opacity-50"
                >
                  Make it the cover<span className="sr-only"> (photo {i + 1})</span>
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => setRemoving(photo)}
                className="min-h-9 text-sm font-medium text-ink-2 underline-offset-4 hover:text-ink hover:underline disabled:opacity-50"
              >
                Remove<span className="sr-only"> photo {i + 1}</span>
              </button>
            </div>
          </li>
        ))}
        {!full && !chosen && (
          <li>
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line text-sm font-medium text-ink-2 transition-colors hover:border-control hover:text-ink"
            >
              <ImagePlus className="size-6" aria-hidden />
              {photos.length === 0 ? 'Add a cover photo' : 'Add a photo'}
            </button>
          </li>
        )}
      </ul>
      {full && <p className="text-sm text-ink-3">That’s {MAX_PHOTOS} photos, the most a page can have.</p>}

      {chosen && (
        <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4 animate-rise">
          <p className="text-sm text-ink-2">
            <span className="font-medium text-ink">{chosen.name}</span> · {fileSize(chosen.size)}
          </p>
          <Field
            label="Describe it"
            hint="For people who can’t see it, like “The front of the shop on Main Boulevard”."
          >
            <CleanTextInput
              kind="line"
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              maxLength={300}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" loading={busy} onClick={() => void add()}>
              Add the photo
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setChosen(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept={PICTURE_TYPES.join(',')}
        aria-label="Photo file"
        className="hidden"
        onChange={(e) => choose(e.target.files?.[0])}
      />
      {problem && <Alert tone="danger" title={problem} />}

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent
          title="Remove this photo?"
          description={
            removing?.isPrimary && photos.length > 1
              ? 'It’s the cover: the next photo becomes the cover instead.'
              : 'It’s deleted from your page.'
          }
        >
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button variant="secondary">Keep it</Button>
            </DialogClose>
            <Button
              variant="danger"
              loading={busy}
              onClick={() =>
                void run(
                  () => removePhoto(business.id, removing!.id),
                  'The photo is removed.',
                  'Removing it didn’t work. Please try again.',
                ).then((ok) => ok && setRemoving(null))
              }
            >
              Remove photo
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
