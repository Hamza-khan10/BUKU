'use client';

import { Copy, Download } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/choice';
import { toast } from '@/components/ui/toaster';
import { recoveryCodesFile } from '../two-step';

/**
 * Recovery codes, shown once: copy them, download them as a text file, and
 * say they're kept somewhere safe before going on — they're the way back in
 * if the phone with the app is lost.
 */
export function RecoveryCodes({
  codes,
  account,
  onDone,
}: {
  codes: string[];
  /** Whose codes (an email), written in the file. */
  account: string;
  onDone: () => void;
}) {
  const [saved, setSaved] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      toast.success('Copied. Paste them somewhere safe.');
    } catch {
      toast.error('Copying didn’t work here. Download them instead, or write them down.');
    }
  };

  const download = () => {
    const file = recoveryCodesFile(codes, account, new Date());
    const url = URL.createObjectURL(new Blob([file.text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4">
      <Alert tone="wait" title="Save these now. They won’t be shown again">
        If you lose the phone with your app, each code lets you sign in once. With one you can also turn
        two-step sign-in off, or get new codes.
      </Alert>
      <ol
        aria-label="Your recovery codes"
        className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-line bg-sunken p-4 font-mono text-base tracking-wider text-ink sm:grid-cols-2"
      >
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void copy()}>
          <Copy aria-hidden /> Copy
        </Button>
        <Button variant="secondary" onClick={download}>
          <Download aria-hidden /> Download
        </Button>
      </div>
      <Checkbox
        label="I’ve saved my recovery codes somewhere safe"
        checked={saved}
        onCheckedChange={(v) => setSaved(v === true)}
      />
      <Button variant="primary" disabled={!saved} onClick={onDone} className="w-fit">
        Done
      </Button>
    </div>
  );
}
