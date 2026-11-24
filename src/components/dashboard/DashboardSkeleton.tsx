import type { UserRole } from '../../../packages/shared/types';

interface DashboardSkeletonProps {
  role?: UserRole;
  activeTab?: string;
}

function PulseBar({ className = '' }: { className?: string }) {
  return (
    <div
      className={`bg-slate-200/80 rounded animate-pulse motion-reduce:animate-none ${className}`}
      aria-hidden="true"
    />
  );
}

export function DashboardSkeleton({ role = 'admin', activeTab = 'overview' }: DashboardSkeletonProps) {
  const showDualAxisChart = activeTab === 'overview' && (role === 'admin' || role === 'super-admin');

  if (activeTab !== 'overview') {
    return (
      <div className="space-y-6" role="status" aria-busy="true" aria-label="Loading portal section">
        <span className="sr-only">Loading portal records...</span>

        {/* Filter / Form Toolbar Skeleton */}
        <div className="border border-slate-200 bg-white rounded-lg p-5 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div className="space-y-1.5">
            <PulseBar className="h-3 w-16" />
            <PulseBar className="h-9 w-full" />
          </div>
          <div className="space-y-1.5">
            <PulseBar className="h-3 w-20" />
            <PulseBar className="h-9 w-full" />
          </div>
          <div className="space-y-1.5">
            <PulseBar className="h-3 w-24" />
            <PulseBar className="h-9 w-full" />
          </div>
          <div className="space-y-1.5">
            <PulseBar className="h-3 w-28" />
            <PulseBar className="h-9 w-full" />
          </div>
          <PulseBar className="h-9 w-full" />
        </div>

        {/* High-Density Data Table Skeleton (36px-44px row cadence) */}
        <div className="border border-slate-200 bg-white rounded-lg overflow-hidden">
          <div className="bg-slate-50 border-b border-slate-200 px-4 py-3 grid grid-cols-6 gap-4">
            <PulseBar className="h-3 w-24" />
            <PulseBar className="h-3 w-20" />
            <PulseBar className="h-3 w-24" />
            <PulseBar className="h-3 w-16" />
            <PulseBar className="h-3 w-16 justify-self-end" />
            <PulseBar className="h-3 w-14 justify-self-end" />
          </div>
          <div className="divide-y divide-slate-100">
            {[1, 2, 3, 4, 5, 6].map((row) => (
              <div key={row} className="px-4 h-11 grid grid-cols-6 gap-4 items-center">
                <PulseBar className="h-3.5 w-28" />
                <PulseBar className="h-3.5 w-24" />
                <PulseBar className="h-3.5 w-32" />
                <PulseBar className="h-3.5 w-20" />
                <PulseBar className="h-3.5 w-16 justify-self-end" />
                <PulseBar className="h-3.5 w-12 justify-self-end" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-label="Loading dashboard overview">
      <span className="sr-only">Loading dashboard telemetry...</span>

      {/* 4-Column KPI Strip matching OverviewSection */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-slate-200 bg-white rounded-lg divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        {[1, 2, 3, 4].map((idx) => (
          <div key={idx} className="p-5 space-y-2.5">
            <PulseBar className="h-3 w-28" />
            <PulseBar className="h-7 w-36" />
          </div>
        ))}
      </div>

      {/* Recharts Revenue & Active Sessions Skeleton (Admin / Super Admin) */}
      {showDualAxisChart && (
        <div className="border border-slate-200 bg-white rounded-lg p-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-100">
            <div className="space-y-2">
              <PulseBar className="h-4 w-52" />
              <PulseBar className="h-3 w-80 max-w-full" />
            </div>
            <div className="flex items-center gap-2">
              <PulseBar className="h-8 w-56 rounded-md" />
              <PulseBar className="h-8 w-20 rounded-md" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-4 border-b border-slate-100 mb-5">
            {[1, 2, 3].map((stat) => (
              <div key={stat} className="space-y-2">
                <PulseBar className="h-3 w-32" />
                <PulseBar className="h-5 w-28" />
              </div>
            ))}
          </div>

          <div className="h-[300px] flex items-end justify-between gap-3 pt-6 px-2">
            {[42, 58, 52, 68, 76, 70, 62, 66, 80, 84, 90, 86, 94, 98].map((pct, idx) => (
              <div key={idx} className="flex-1 h-full flex flex-col justify-end items-center gap-2">
                <div className="w-full max-w-[24px] h-full flex items-end">
                  <div
                    className="w-full bg-slate-200/80 rounded-t animate-pulse motion-reduce:animate-none"
                    style={{ height: `${pct}%` }}
                  />
                </div>
                <PulseBar className="h-2.5 w-8" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lower 12-Col Split: Throughput Chart + Recent System Events */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 border border-slate-200 bg-white rounded-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="space-y-2">
              <PulseBar className="h-4 w-48" />
              <PulseBar className="h-3 w-64 max-w-full" />
            </div>
            <PulseBar className="h-3 w-16" />
          </div>
          <div className="grid grid-cols-6 gap-4 items-end h-44 pt-4">
            {[32, 58, 84, 72, 96, 82].map((pct, idx) => (
              <div key={idx} className="flex flex-col items-center h-full justify-end gap-2">
                <PulseBar className="h-2.5 w-7" />
                <div className="w-full max-w-[40px] bg-slate-100 rounded-t-sm h-full flex items-end overflow-hidden">
                  <div
                    className="w-full bg-slate-200/90 rounded-t-sm animate-pulse motion-reduce:animate-none"
                    style={{ height: `${pct}%` }}
                  />
                </div>
                <PulseBar className="h-2.5 w-9" />
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 border border-slate-200 bg-white rounded-lg p-6">
          <PulseBar className="h-4 w-40 mb-4" />
          <div className="divide-y divide-slate-100">
            {[1, 2, 3, 4, 5].map((item) => (
              <div key={item} className="py-2.5 flex items-start justify-between gap-3">
                <div className="space-y-1.5 flex-1">
                  <PulseBar className="h-3.5 w-36" />
                  <PulseBar className="h-3 w-48 max-w-full" />
                </div>
                <PulseBar className="h-3 w-10 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
