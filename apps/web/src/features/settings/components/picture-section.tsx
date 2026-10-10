'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ImageUp, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toaster';
import { ME_KEY, type Me } from '@/features/auth/api';
import { problemFrom } from '@/features/auth/problems';
import { removePicture, uploadPicture } from '../api';
import { fileSize, isPictureType, MAX_PICTURE_BYTES, pictureProblem, PICTURE_TYPES } from '../picture';
import { SettingsSection } from './section';

/**
 * The profile picture: private (only the person themself ever sees it, D-051),
 * checked here before sending, and cleaned by the API (no location or camera
 * details survive). Removing asks first: a picture from the sign-in provider
 * doesn't come back by itself.
 */
export function PictureSection({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const choose = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    const wrong = pictureProblem(file);
    setProblem(wrong);
    if (wrong || !isPictureType(file.type)) return;

    setBusy(true);
    try {
      queryClient.setQueryData(ME_KEY, await uploadPicture(file, file.type));
      toast.success('Your new picture is saved.');
    } catch (err) {
      setProblem(problemFrom(err, 'Your picture couldn’t be saved. Please try again.').title);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection
      title="Your picture"
      intro="Only you see it, next to your name when you’re signed in. Businesses and other people never do."
    >
      <div className="flex flex-wrap items-center gap-5">
        <Avatar name={me.name} src={me.avatarUrl} size={88} />
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={busy} onClick={() => input.current?.click()}>
              {!busy && <ImageUp aria-hidden />}
              {me.avatarUrl ? 'Choose a new picture' : 'Choose a picture'}
            </Button>
            {me.avatarUrl && !busy && <RemovePicture />}
          </div>
          <p className="text-sm text-ink-3">
            JPEG, PNG or WebP, up to {fileSize(MAX_PICTURE_BYTES)}. Location and camera details hidden in
            photos are removed.
          </p>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept={PICTURE_TYPES.join(',')}
        aria-label="Picture file"
        className="hidden"
        onChange={(e) => void choose(e.target.files?.[0])}
      />
      {problem && <Alert tone="danger" title={problem} />}
    </SettingsSection>
  );
}

function RemovePicture() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      queryClient.setQueryData(ME_KEY, await removePicture());
      setOpen(false);
      toast('Your picture is removed.');
    } catch (err) {
      setError(problemFrom(err, 'Removing it didn’t work. Please try again.').title);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost">
          <Trash2 aria-hidden /> Remove
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Remove your picture?"
        description="Your initials show instead. To have a picture again, choose one here."
      >
        <div className="flex flex-col gap-4">
          {error && <Alert tone="danger" title={error} />}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button variant="secondary">Keep it</Button>
            </DialogClose>
            <Button variant="danger" loading={busy} onClick={() => void remove()}>
              Remove picture
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
