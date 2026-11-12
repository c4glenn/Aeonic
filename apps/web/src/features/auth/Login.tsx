import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { login } from '@/lib/api';

export function Login({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <form
        className="flex w-full max-w-sm flex-col gap-4 rounded-xl border bg-card p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          if (await login(pw)) onDone();
          else setError('That password didn’t work.');
          setBusy(false);
        }}
      >
        <h1 className="text-2xl font-semibold">Todo Tool</h1>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pw">Password</Label>
          <Input id="pw" type="password" autoFocus autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} className="h-11" />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <Button type="submit" className="h-11" disabled={busy || !pw}>Sign in</Button>
      </form>
    </main>
  );
}
