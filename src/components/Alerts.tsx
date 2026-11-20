import { useState } from 'react';
import type { PriceAlert } from '../lib/alerts';
import { Panel, Seg } from './ui';

export function Alerts({ alerts, setAlerts, price24 }: { alerts: PriceAlert[]; setAlerts: (a: PriceAlert[] | ((p: PriceAlert[]) => PriceAlert[])) => void; price24: number | null }) {
  const [dir, setDir] = useState<'above' | 'below'>('above');
  const [target, setTarget] = useState('');
  const [err, setErr] = useState('');
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(() => ('Notification' in window ? Notification.permission : 'unsupported'));

  function add(e: React.FormEvent) {
    e.preventDefault();
    const t = Number(target);
    if (!Number.isFinite(t) || t < 1 || t > 100000) return setErr('Enter a price per gram, for example 440.');
    if (alerts.length >= 20) return setErr('Maximum 20 alerts.');
    setErr('');
    setAlerts((p) => [...p, { id: crypto.randomUUID(), dir, target: t }]);
    setTarget('');
  }

  const fired = alerts.filter((a) => a.firedAt);

  return (
    <Panel title="Price alerts" hint="24K, AED per gram">
      {fired.length > 0 && (
        <div role="status" className="mb-3 rounded-lg border border-[#d9a93f]/50 bg-[#d9a93f]/10 p-3 text-xs text-[#f0cf72]">
          {fired.length === 1 ? '1 alert has triggered.' : `${fired.length} alerts have triggered.`} See below.
        </div>
      )}
      <form onSubmit={add} className="flex flex-wrap items-end gap-2 text-xs">
        <Seg label="Direction" value={dir} onChange={setDir} options={[{ v: 'above', label: 'Rises to' }, { v: 'below', label: 'Falls to' }]} />
        <label className="flex flex-col gap-1 text-[#a39b8a] flex-1 min-w-[110px]">AED per gram
          <input className="field" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={price24 ? price24.toFixed(0) : '440'} />
        </label>
        <button type="submit" className="btn-gold h-[38px]">Add alert</button>
      </form>
      {err && <div role="alert" className="text-xs text-[#ef6b6b] mt-2">{err}</div>}

      <div className="mt-3 flex flex-col divide-y divide-white/[0.06]">
        {alerts.map((a) => (
          <div key={a.id} className="py-2 flex items-center justify-between gap-3 text-xs">
            <span className="font-mono-num">
              {a.dir === 'above' ? 'Rises to' : 'Falls to'} <span className="text-[#f4efe6] font-semibold">{a.target}</span>
              <span className={`ml-2 ${a.firedAt ? 'text-[#f0cf72]' : 'text-[#7d7667]'}`}>
                {a.firedAt ? `triggered ${new Date(a.firedAt).toLocaleTimeString()}` : 'armed'}
              </span>
            </span>
            <span className="flex gap-3 text-[10px] text-[#7d7667]">
              {a.firedAt && <button type="button" className="underline underline-offset-2 hover:text-[#f0cf72] cursor-pointer" onClick={() => setAlerts((p) => p.map((x) => (x.id === a.id ? { ...x, firedAt: undefined } : x)))}>re-arm</button>}
              <button type="button" className="underline underline-offset-2 hover:text-[#ef6b6b] cursor-pointer" onClick={() => setAlerts((p) => p.filter((x) => x.id !== a.id))}>remove</button>
            </span>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-[#7d7667] mt-3 leading-relaxed">
        Alerts are checked while this page is open in your browser (a background tab is fine). They cannot run when the page is closed.{' '}
        {perm === 'default' && <button type="button" className="underline underline-offset-2 text-[#f0cf72] cursor-pointer" onClick={() => Notification.requestPermission().then(setPerm)}>Turn on desktop notifications</button>}
        {perm === 'granted' && 'Desktop notifications are on.'}
        {perm === 'denied' && 'Desktop notifications are blocked in your browser; you will still see alerts here.'}
      </p>
      <p className="text-[10px] text-[#7d7667] mt-2 leading-relaxed">
        Email and WhatsApp alerts run every 10 minutes even when this page is closed.{' '}
        <a href="https://github.com/HasnainQaiyumi/Gold-price-tracker/edit/main/public/alerts.config.json" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 text-[#f0cf72]">Change their prices</a>
      </p>
    </Panel>
  );
}
