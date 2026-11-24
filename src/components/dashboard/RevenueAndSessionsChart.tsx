import { useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DailyMetricPoint } from '../../../packages/shared/types';

export type ChartDisplayMode = 'combined' | 'revenue' | 'sessions';

interface RevenueAndSessionsChartProps {
  data: DailyMetricPoint[];
  title?: string;
  subtitle?: string;
  height?: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    dataKey?: string;
    value?: number;
    color?: string;
  }>;
  label?: string;
}

function ChartTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const revenueItem = payload.find((p) => p.dataKey === 'revenueTzs');
  const sessionsItem = payload.find((p) => p.dataKey === 'activeSessions');

  return (
    <div className="bg-white border border-slate-200 rounded-md px-3.5 py-2.5 shadow-sm text-xs">
      <div className="font-semibold text-slate-900 mb-1.5">{label}</div>
      {revenueItem && (
        <div className="flex items-center justify-between gap-4 text-slate-700">
          <span>Daily Revenue</span>
          <span className="font-mono font-semibold text-blue-700 tabular-nums">
            TZS {Number(revenueItem.value || 0).toLocaleString()}
          </span>
        </div>
      )}
      {sessionsItem && (
        <div className="flex items-center justify-between gap-4 text-slate-700 mt-1">
          <span>Active Sessions</span>
          <span className="font-mono font-semibold text-emerald-700 tabular-nums">
            {Number(sessionsItem.value || 0).toLocaleString()}
          </span>
        </div>
      )}
    </div>
  );
}

function formatCompactTzs(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

export function RevenueAndSessionsChart({
  data,
  title = 'Daily Revenue & Active Sessions',
  subtitle = 'DaliPay & agent voucher settlements paired with concurrent FreeRADIUS sessions',
  height = 300,
}: RevenueAndSessionsChartProps) {
  const [mode, setMode] = useState<ChartDisplayMode>('combined');
  const [rangeDays, setRangeDays] = useState<7 | 14>(14);

  const visibleData = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data.slice(-rangeDays);
  }, [data, rangeDays]);

  const summary = useMemo(() => {
    if (visibleData.length === 0) {
      return { totalRevenue: 0, peakSessions: 0, avgSessions: 0 };
    }
    const totalRevenue = visibleData.reduce((acc, d) => acc + d.revenueTzs, 0);
    const peakSessions = Math.max(...visibleData.map((d) => d.activeSessions));
    const avgSessions = Math.round(
      visibleData.reduce((acc, d) => acc + d.activeSessions, 0) / visibleData.length
    );
    return { totalRevenue, peakSessions, avgSessions };
  }, [visibleData]);

  return (
    <section className="border border-slate-200 bg-white rounded-lg p-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-100">
        <div>
          <h2 className="font-display text-base font-bold text-slate-900">{title}</h2>
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            {(
              [
                { id: 'combined', label: 'Combined' },
                { id: 'revenue', label: 'Revenue (TZS)' },
                { id: 'sessions', label: 'Active Sessions' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setMode(tab.id)}
                className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors cursor-pointer whitespace-nowrap ${
                  mode === tab.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            {([7, 14] as const).map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setRangeDays(days)}
                className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors cursor-pointer whitespace-nowrap ${
                  rangeDays === days ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {days}D
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Period Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-4 border-b border-slate-100 mb-5">
        <div>
          <div className="text-xs text-slate-500">Period Revenue ({rangeDays} Days)</div>
          <div className="font-mono text-lg font-bold text-slate-900 tabular-nums mt-0.5">
            TZS {summary.totalRevenue.toLocaleString()}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Average Daily Sessions</div>
          <div className="font-mono text-lg font-bold text-slate-900 tabular-nums mt-0.5">
            {summary.avgSessions.toLocaleString()}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Peak Concurrent Sessions</div>
          <div className="font-mono text-lg font-bold text-emerald-700 tabular-nums mt-0.5">
            {summary.peakSessions.toLocaleString()}
          </div>
        </div>
      </div>

      {visibleData.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-xs text-slate-500">
          No daily telemetry recorded yet for this organization.
        </div>
      ) : (
        <div style={{ width: '100%', height }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={visibleData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: '#64748B', fontFamily: 'JetBrains Mono, monospace' }}
                axisLine={{ stroke: '#E2E8F0' }}
                tickLine={false}
              />
              {(mode === 'combined' || mode === 'revenue') && (
                <YAxis
                  yAxisId="revenue"
                  orientation="left"
                  tickFormatter={formatCompactTzs}
                  tick={{ fontSize: 11, fill: '#64748B', fontFamily: 'JetBrains Mono, monospace' }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                />
              )}
              {(mode === 'combined' || mode === 'sessions') && (
                <YAxis
                  yAxisId="sessions"
                  orientation={mode === 'sessions' ? 'left' : 'right'}
                  tick={{ fontSize: 11, fill: '#64748B', fontFamily: 'JetBrains Mono, monospace' }}
                  axisLine={false}
                  tickLine={false}
                  width={42}
                />
              )}
              <Tooltip content={<ChartTooltip />} />
              {(mode === 'combined' || mode === 'revenue') && (
                <Bar
                  yAxisId="revenue"
                  dataKey="revenueTzs"
                  name="Daily Revenue (TZS)"
                  fill="#1D4ED8"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
              )}
              {(mode === 'combined' || mode === 'sessions') && (
                <Line
                  yAxisId="sessions"
                  type="monotone"
                  dataKey="activeSessions"
                  name="Active Sessions"
                  stroke="#16A34A"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: '#16A34A', strokeWidth: 0 }}
                  activeDot={{ r: 5, fill: '#16A34A' }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-6 text-xs text-slate-600">
        {(mode === 'combined' || mode === 'revenue') && (
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-xs bg-blue-700 inline-block" aria-hidden="true" />
            <span>Daily Revenue (TZS)</span>
          </div>
        )}
        {(mode === 'combined' || mode === 'sessions') && (
          <div className="flex items-center gap-2">
            <span className="w-3 h-0.5 bg-emerald-600 inline-block" aria-hidden="true" />
            <span>Active FreeRADIUS Sessions</span>
          </div>
        )}
      </div>
    </section>
  );
}
