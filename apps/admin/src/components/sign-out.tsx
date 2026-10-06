'use client';

import { useState } from 'react';
import { post } from '@admin/lib/client';
import { Button } from './ui';

export function SignOut() {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      busy={busy}
      onClick={() => {
        setBusy(true);
        void post('/api/session/signout').then(() => window.location.assign('/signin'));
      }}
    >
      Sign out
    </Button>
  );
}
