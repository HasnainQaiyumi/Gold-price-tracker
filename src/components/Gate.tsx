import { useRef, useState } from 'react';
import { verifyPassword } from '../lib/gate';

export function Gate({ onUnlock }: { onUnlock: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const fails = useRef(0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr('');
    const ok = await verifyPassword(pw);
    if (ok) {
      onUnlock();
      return;
    }
    fails.current += 1;
    // Friction against rapid guessing (client-side only; see gate.ts for limits).
    await new Promise((r) => setTimeout(r, Math.min(8000, 700 * 2 ** (fails.current - 1))));
    setErr('Wrong password.');
    setPw('');
    setBusy(false);
  }

  return (
    <main className="min-h-screen grid place-items-center px-4">
      <form onSubmit={submit} className="panel w-full max-w-sm flex flex-col gap-4" aria-label="Unlock">
        <div className="flex items-center gap-3">
          <span className="coin" aria-hidden />
          <div>
            <div className="wordmark">GOLD</div>
            <div className="text-xs text-[#a39b8a]">Private. Enter your password.</div>
          </div>
        </div>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Password"
          aria-label="Password"
          className="field"
        />
        {err && <div role="alert" className="text-xs text-[#ef6b6b]">{err}</div>}
        <button type="submit" disabled={busy || !pw} className="btn-gold">
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </main>
  );
}
