import { useEffect, useState } from 'react';
import { http } from '../../../lib/http';
import { term } from '../../../lib/strings';
import { SettingsTitle, SettingsSection } from '../SettingsLayout';
import { Dropdown } from '../../common/Dropdown';

interface Insights {
  days: number;
  totals: { members: number; newMembers: number; messages: number; communicators: number };
  joinMethods: Record<string, number>;
  series: Array<{ day: string; joins: number; messages: number; communicators: number }>;
  topRelays: Array<{ relayId: string; name: string; messages: number }>;
}

const METHOD_LABELS: Record<string, string> = { invite: 'Invite link', discovery: 'Discover', owner: 'Owner', unknown: 'Before this was recorded' };
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-raised p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-fg">{value.toLocaleString()}</p>
    </div>
  );
}

/** One measure per day as thin bars, with a tooltip on hover and the numbers in a table for screen readers. */
function DailyBars({ title, data, field }: { title: string; data: Insights['series']; field: 'joins' | 'messages' | 'communicators' }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d[field]));
  const W = 600;
  const H = 120;
  const step = W / data.length;
  const bar = Math.max(2, step - 2);
  return (
    <figure className="mb-6">
      <figcaption className="mb-2 text-sm font-semibold text-fg">{title}</figcaption>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full" role="img" aria-label={`${title}, last ${data.length} days`}>
          <line x1={0} x2={W} y1={H} y2={H} stroke="var(--color-line)" />
          {data.map((d, i) => {
            const h = (d[field] / max) * (H - 8);
            return (
              <g key={d.day} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                {/* Taller hit target than the mark. */}
                <rect x={i * step} y={0} width={step} height={H} fill="transparent" />
                {d[field] > 0 && <rect x={i * step + (step - bar) / 2} y={H - h} width={bar} height={h} rx={Math.min(2, bar / 2)} fill="#3B8EF2" opacity={hover === null || hover === i ? 1 : 0.5} />}
              </g>
            );
          })}
          <text x={0} y={H + 14} fill="var(--color-fg-subtle)" fontSize={11}>{dayLabel(data[0].day)}</text>
          <text x={W} y={H + 14} fill="var(--color-fg-subtle)" fontSize={11} textAnchor="end">{dayLabel(data[data.length - 1].day)}</text>
        </svg>
        {hover !== null && (
          <div className="pointer-events-none absolute -top-2 rounded-md bg-overlay px-2 py-1 text-xs shadow-pop" style={{ left: `${((hover + 0.5) / data.length) * 100}%`, transform: 'translate(-50%, -100%)' }}>
            <span className="text-fg-muted">{dayLabel(data[hover].day)}</span> <span className="font-semibold tabular-nums text-fg">{data[hover][field]}</span>
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <th scope="row">{d.day}</th>
              <td>{d[field]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Discord's Server Insights: growth and activity over the last weeks. */
export function InsightsTab({ beaconId }: { beaconId: string }) {
  const [days, setDays] = useState('30');
  const [data, setData] = useState<Insights | null>(null);
  useEffect(() => {
    setData(null);
    http.get<Insights>(`/beacons/${beaconId}/insights?days=${days}`).then(setData).catch(() => undefined);
  }, [beaconId, days]);

  return (
    <>
      <SettingsTitle>{term('beacon')} Insights</SettingsTitle>
      <div className="mb-6 w-48">
        <Dropdown
          label="Time range"
          value={days}
          options={[
            { value: '7', label: 'Last 7 days' },
            { value: '30', label: 'Last 30 days' },
            { value: '90', label: 'Last 90 days' },
          ]}
          onChange={setDays}
        />
      </div>
      {!data ? (
        <p className="text-sm text-fg-subtle">Loading…</p>
      ) : (
        <>
          <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Members" value={data.totals.members} />
            <Tile label="New members" value={data.totals.newMembers} />
            <Tile label="Transmissions" value={data.totals.messages} />
            <Tile label="Communicators" value={data.totals.communicators} />
          </div>
          <SettingsSection id="growth" title="Growth">
            <DailyBars title="New members per day" data={data.series} field="joins" />
          </SettingsSection>
          <SettingsSection id="engagement" title="Engagement">
            <DailyBars title="Transmissions per day" data={data.series} field="messages" />
            <DailyBars title="Members who sent a transmission, per day" data={data.series} field="communicators" />
          </SettingsSection>
          <SettingsSection id="breakdown" title="Breakdown">
            <div className="grid gap-6 md:grid-cols-2">
              <table aria-label={`Most active ${term('relay', true).toLowerCase()}`} className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-fg-subtle">
                    <th className="pb-2 font-semibold">Most active {term('relay', true).toLowerCase()}</th>
                    <th className="pb-2 text-right font-semibold">Transmissions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topRelays.length === 0 && (
                    <tr>
                      <td colSpan={2} className="py-2 text-fg-subtle">Nothing sent in this range.</td>
                    </tr>
                  )}
                  {data.topRelays.map((r) => (
                    <tr key={r.relayId} className="border-t border-line">
                      <td className="py-2 text-fg">#{r.name}</td>
                      <td className="py-2 text-right tabular-nums text-fg">{r.messages.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <table aria-label="How members joined" className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-fg-subtle">
                    <th className="pb-2 font-semibold">How members joined</th>
                    <th className="pb-2 text-right font-semibold">Members</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.joinMethods).map(([m, n]) => (
                    <tr key={m} className="border-t border-line">
                      <td className="py-2 text-fg">{METHOD_LABELS[m] ?? m}</td>
                      <td className="py-2 text-right tabular-nums text-fg">{n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SettingsSection>
        </>
      )}
    </>
  );
}
