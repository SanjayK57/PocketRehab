import type { ExerciseDefinition } from '@/types/exercise';
import type { Session } from '@/lib/validation/schemas';
import { formatDuration } from '@/lib/time/dates';
import { Tag } from '@/components/ui';

const FLAG_LABEL: Record<string, string> = {
  'low-visibility': 'hard to see',
  'near-edge': 'near frame edge',
  'implausible-jump': 'tracking glitch',
  'view-mismatch': 'camera angle',
  'out-of-frame': 'out of frame',
  'no-pose': 'not detected',
  'landmark-missing': 'points missing',
};

/** Timeline of every counted repetition with its quality flags. */
export function RepTable({ session, def }: { session: Session; def: ExerciseDefinition }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left">
        <caption className="sr-only">Repetitions in this session</caption>
        <thead>
          <tr className="border-b border-ink text-sm text-ink-2">
            <th scope="col" className="py-2 pr-3 font-semibold">Rep</th>
            <th scope="col" className="py-2 pr-3 font-semibold">Set</th>
            <th scope="col" className="py-2 pr-3 font-semibold">At</th>
            <th scope="col" className="py-2 pr-3 font-semibold">Peak</th>
            <th scope="col" className="py-2 pr-3 font-semibold">Range</th>
            <th scope="col" className="py-2 pr-3 font-semibold">Time</th>
            <th scope="col" className="py-2 pr-3 font-semibold">Target</th>
            <th scope="col" className="py-2 font-semibold">Tracking</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {session.reps.map((r) => (
            <tr key={r.index} className={r.validity === 'reliable' ? '' : 'text-ink-2'}>
              <td className="num py-2 pr-3">{r.index}</td>
              <td className="num py-2 pr-3">{r.setIndex}</td>
              <td className="num py-2 pr-3">{formatDuration(r.startedAt)}</td>
              <td className="num py-2 pr-3">{r.peakValue}°</td>
              <td className="num py-2 pr-3">{r.range}°</td>
              <td className="num py-2 pr-3">{formatDuration(r.durationMs)}</td>
              <td className="py-2 pr-3">{r.targetMet === null ? '—' : r.validity !== 'reliable' ? 'not judged' : r.targetMet ? 'in range' : 'outside range'}</td>
              <td className="py-2">
                <span className="flex flex-wrap items-center gap-1">
                  <Tag tone={r.validity === 'reliable' ? 'ok' : 'warn'}>{r.validity === 'reliable' ? 'reliable' : 'uncertain · excluded'}</Tag>
                  {r.compensation.map((c) => (
                    <Tag key={c} tone="signal">
                      {def.compensationRules.find((x) => x.id === c)?.label ?? c}
                    </Tag>
                  ))}
                  {r.qualityFlags.filter((f) => FLAG_LABEL[f]).map((f) => (
                    <Tag key={f}>{FLAG_LABEL[f]}</Tag>
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
