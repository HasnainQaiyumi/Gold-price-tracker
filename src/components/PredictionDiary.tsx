import { addDays, diaryStats, type Diary, type DiaryRange } from '../lib/diary';

interface Props {
  diary: Diary | null;
  toAed: (usd: number) => number;
  unitText: string;
}

const aed = (v: number) => `AED ${v >= 1000 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2)}`;
const nice = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function Verdict({ range, actual, due, toAed }: { range: DiaryRange; actual: number | null | undefined; due: string; toAed: (usd: number) => number }) {
  const span = `${aed(toAed(range.lo))} to ${aed(toAed(range.hi))}`;
  if (!actual) {
    return (
      <div className="text-[13px] text-[#a39b8a]">
        <span className="text-[#e8e1d2]">{span}</span>
        <span className="block text-[11px] text-[#8a8374]">⏳ result on {nice(due)}</span>
      </div>
    );
  }
  const inside = actual >= range.lo && actual <= range.hi;
  return (
    <div className="text-[13px]">
      <span className="text-[#e8e1d2]">{span}</span>
      <span className={`block text-[11px] font-semibold ${inside ? 'text-[#6fcf97]' : 'text-[#ef6b6b]'}`}>
        {inside ? '✓' : '✗'} real price {aed(toAed(actual))}
      </span>
    </div>
  );
}

/** Predictions written down on the day they were made, then checked against what really happened. */
export function PredictionDiary({ diary, toAed, unitText }: Props) {
  if (!diary || !diary.entries.length) return null;
  const s = diaryStats(diary);
  const recent = [...diary.entries].reverse().slice(0, 10);
  const score = (x: { checked: number; inside: number }) =>
    x.checked ? `${x.inside} of ${x.checked} came true` : 'no results yet';

  return (
    <section aria-label="Prediction diary" className="panel">
      <header className="mb-4">
        <h2 className="panel-title text-[1.35rem]">Prediction diary</h2>
        <p className="text-xs text-[#a39b8a] mt-1 max-w-[780px]">
          Every day we write down the 99% ranges for next week and next month from "Where will gold be?", before anyone knows the answer, and mark them right or wrong when the day comes. Nothing here can be changed afterwards, so this is the most honest score we have. Prices in AED {unitText}.
        </p>
      </header>

      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        <div className="rounded-2xl bg-[#0d0c09] border border-white/[0.07] p-4">
          <div className="text-[11px] uppercase tracking-[0.12em] text-[#8a8374]">Days recorded</div>
          <div className="font-display text-2xl font-semibold text-[#fbf7ef] mt-1">{s.days}</div>
          <div className="text-[11px] text-[#8a8374] mt-1">since {nice(diary.startedAt)}</div>
        </div>
        <div className="rounded-2xl bg-[#0d0c09] border border-white/[0.07] p-4">
          <div className="text-[11px] uppercase tracking-[0.12em] text-[#8a8374]">Next-week ranges</div>
          <div className="font-display text-2xl font-semibold text-[#6fcf97] mt-1">{s.week.checked ? `${Math.round((s.week.inside / s.week.checked) * 100)}%` : '—'}</div>
          <div className="text-[11px] text-[#8a8374] mt-1">{score(s.week)}</div>
        </div>
        <div className="rounded-2xl bg-[#0d0c09] border border-white/[0.07] p-4">
          <div className="text-[11px] uppercase tracking-[0.12em] text-[#8a8374]">Next-month ranges</div>
          <div className="font-display text-2xl font-semibold text-[#6fcf97] mt-1">{s.month.checked ? `${Math.round((s.month.inside / s.month.checked) * 100)}%` : '—'}</div>
          <div className="text-[11px] text-[#8a8374] mt-1">{score(s.month)}</div>
        </div>
      </div>

      {s.nextResult && (
        <p className="text-[13px] text-[#cfc7b6] mb-3">
          The first result comes in on <span className="font-semibold text-[#fbf7ef]">{nice(s.nextResult)}</span>. With a 99% range, expect about 1 miss in every 100 days, never zero forever.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left min-w-[520px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-[0.1em] text-[#8a8374]">
              <th className="py-2 pr-3 font-semibold">Written on</th>
              <th className="py-2 pr-3 font-semibold">Price then</th>
              <th className="py-2 pr-3 font-semibold">Next week, 99% sure</th>
              <th className="py-2 font-semibold">Next month, 99% sure</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((e) => (
              <tr key={e.date} className="border-t border-white/[0.06] align-top">
                <td className="py-2.5 pr-3 text-[13px] text-[#e8e1d2]">{nice(e.date)}</td>
                <td className="py-2.5 pr-3 text-[13px] text-[#e8e1d2]">{aed(toAed(e.spot))}</td>
                <td className="py-2.5 pr-3"><Verdict range={e.week} actual={e.weekActual} due={addDays(e.date, 7)} toAed={toAed} /></td>
                <td className="py-2.5"><Verdict range={e.month} actual={e.monthActual} due={addDays(e.date, 30)} toAed={toAed} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
