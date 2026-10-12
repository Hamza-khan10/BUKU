'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ImageUp, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/choice';
import { toast } from '@/components/ui/toaster';
import { problemFrom } from '@/features/auth/problems';
import { pictureProblem, PICTURE_TYPES } from '@/features/settings/picture';
import { removeStaffPhoto, staffKey, uploadStaffPhoto, type ManagedStaff } from '../api';

/**
 * Someone's photo on the business's page: optional, and only with their agreement (D-051) — the
 * box is ticked before a photo can be chosen, and the API keeps who confirmed it and when. They
 * can remove it themselves, and it goes when they leave the team.
 */
export function StaffPhoto({ businessId, person }: { businessId: string; person: ManagedStaff }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const saved = (photoUrl: string | null) =>
    queryClient.setQueryData<ManagedStaff[]>(staffKey(businessId), (list) =>
      list?.map((s) => (s.id === person.id ? { ...s, photoUrl } : s)),
    );

  const choose = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    const wrong = pictureProblem(file);
    setProblem(wrong);
    if (wrong) return;
    setBusy(true);
    try {
      saved((await uploadStaffPhoto(businessId, person.id, file, file.type)).photoUrl);
      setAgreed(false);
      toast.success(`${person.displayName}’s photo is saved.`);
    } catch (err) {
      setProblem(problemFrom(err, 'The photo couldn’t be saved. Please try again.').title);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await removeStaffPhoto(businessId, person.id);
      saved(null);
      toast(`${person.displayName}’s photo is removed.`);
    } catch (err) {
      setProblem(problemFrom(err, 'Removing it didn’t work. Please try again.').title);
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-[0.95rem] font-medium text-ink">Photo</legend>
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={person.displayName} src={person.photoUrl} size={72} />
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-2">
          {!person.photoUrl && (
            <Checkbox
              checked={agreed}
              onCheckedChange={(v) => setAgreed(v === true)}
              label={`${person.displayName} agreed to have their photo on your page`}
              description="Customers see it when choosing who does their visit. Without one, their initials show."
            />
          )}
          <div className="flex flex-wrap gap-2">
            {person.photoUrl ? (
              <Button size="sm" variant="ghost" loading={busy} onClick={() => void remove()}>
                {!busy && <Trash2 aria-hidden />} Remove the photo
              </Button>
            ) : (
              <Button size="sm" disabled={!agreed} loading={busy} onClick={() => input.current?.click()}>
                {!busy && <ImageUp aria-hidden />} Choose a photo
              </Button>
            )}
          </div>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept={PICTURE_TYPES.join(',')}
        aria-label={`${person.displayName}’s photo file`}
        className="hidden"
        onChange={(e) => void choose(e.target.files?.[0])}
      />
      {problem && <Alert tone="danger" title={problem} />}
    </fieldset>
  );
}
