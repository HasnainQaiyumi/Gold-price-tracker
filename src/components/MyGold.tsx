import { useState } from 'react';
import { fmtAed, KARATS } from '../lib/goldPricing';
import { holdingStats, holdingsTotal, sanitizeHoldings, type Holding } from '../lib/holdings';
import type { KaratPurity } from '../lib/types';
import { Panel } from './ui';

const sign = (v: number) => (v >= 0 ? '+' : '−');
const tone = (v: number | null) => (v === null ? 'text-[#a39b8a]' : v >= 0 ? 'text-[#6fcf97]' : 'text-[#ef6b6b]');

export function MyGold({ holdings, setHoldings, spotUsd }: { holdings: Holding[]; setHoldings: (h: Holding[] | ((p: Holding[]) => Holding[])) => void; spotUsd: number | null }) {
  const [grams, setGrams] = useState('');
  const [karat, setKarat] = useState<KaratPurity>(24);
  const [paid, setPaid] = useState('');
  const [err, setErr] = useState('');

  function add(e: React.FormEvent) {
    e.preventDefault();
    const cand = { id: crypto.randomUUID(), grams: Number(grams), karat, paidAed: paid === '' ? 0 : Number(paid) };
    const ok = sanitizeHoldings([cand]);
    if (!ok.length) return setErr('Enter a weight above 0 and a valid price.');
    setErr('');
    setHoldings((p) => sanitizeHoldings([...p, ok[0]]));
    setGrams('');
    setPaid('');
  }

  const t = spotUsd ? holdingsTotal(holdings, spotUsd) : null;

  return (
    <Panel title="My gold" hint="saved only in this browser">
      <form onSubmit={add} className="grid grid-cols-[1fr_auto_1fr_auto] gap-2 items-end text-xs">
        <label className="flex flex-col gap-1 text-[#a39b8a]">Weight (g)
          <input className="field" inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} placeholder="10" />
        </label>
        <label className="flex flex-col gap-1 text-[#a39b8a]">Karat
          <select className="field" value={karat} onChange={(e) => setKarat(Number(e.target.value) as KaratPurity)}>
            {KARATS.map((k) => <option key={k} value={k}>{k}K</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[#a39b8a]">Paid in total (AED, optional)
          <input className="field" inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder="4300" />
        </label>
        <button type="submit" className="btn-gold h-[38px]">Add</button>
      </form>
      {err && <div role="alert" className="text-xs text-[#ef6b6b] mt-2">{err}</div>}

      {holdings.length === 0 ? (
        <p className="text-xs text-[#7d7667] mt-4">Add what you own to see its live value and profit or loss.</p>
      ) : (
        <div className="mt-4 flex flex-col divide-y divide-white/[0.06]">
          {holdings.map((h) => {
            const s = spotUsd ? holdingStats(h, spotUsd) : null;
            return (
              <div key={h.id} className="py-2.5 grid grid-cols-[1fr_auto] gap-x-3 text-xs items-center">
                <div>
                  <span className="font-semibold text-[#f4efe6]">{h.grams} g · {h.karat}K</span>
                  <span className="text-[#7d7667]"> {h.paidAed > 0 ? `paid AED ${fmtAed(h.paidAed)}` : 'cost not entered'}</span>
                  {s?.breakEven24 != null && <div className="text-[10px] text-[#7d7667]">breaks even when 24K spot reaches AED {s.breakEven24.toFixed(2)}/g</div>}
                </div>
                <div className="text-right font-mono-num">
                  <div className="text-[#f0cf72] font-semibold">{s ? `AED ${fmtAed(s.sellValue)}` : '—'}</div>
                  {s?.pl != null && <div className={tone(s.pl)}>{sign(s.pl)}{fmtAed(Math.abs(s.pl))} ({s.plPct!.toFixed(1)}%)</div>}
                </div>
                <button type="button" onClick={() => setHoldings((p) => p.filter((x) => x.id !== h.id))} className="text-[10px] text-[#7d7667] hover:text-[#ef6b6b] underline underline-offset-2 justify-self-start cursor-pointer mt-1" aria-label={`Remove ${h.grams} g ${h.karat}K`}>remove</button>
              </div>
            );
          })}
          {t && (
            <div className="pt-3 flex items-baseline justify-between text-sm">
              <span className="text-[#a39b8a]">Total ({t.fine.toFixed(2)} g pure gold)</span>
              <span className="font-mono-num text-right">
                <span className="text-[#f0cf72] font-semibold">AED {fmtAed(t.sell)}</span>
                {t.pl !== null && <span className={`block text-xs ${tone(t.pl)}`}>{sign(t.pl)}{fmtAed(Math.abs(t.pl))} ({t.plPct!.toFixed(1)}%) on items with a cost</span>}
              </span>
            </div>
          )}
        </div>
      )}
      <p className="text-[10px] text-[#7d7667] mt-3 leading-relaxed">Values assume a 1% shop buy-back cut below spot and ignore making charges. A real shop may offer less.</p>
    </Panel>
  );
}
