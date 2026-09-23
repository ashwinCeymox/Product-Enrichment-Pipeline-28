import React from 'react';

/**
 * Base shimmer bar — animates a gradient sweep left-to-right.
 * All skeleton layouts compose this primitive.
 */
export function ShimmerBar({ className = '' }) {
  return (
    <div
      className={`relative overflow-hidden rounded bg-slate-200 ${className}`}
      style={{ isolation: 'isolate' }}
    >
      <div
        className="absolute inset-0 -translate-x-full animate-[shimmer_1.8s_infinite]"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%)',
        }}
      />
    </div>
  );
}

/* ─── Dashboard Skeleton ──────────────────────────────────────────── */
export function DashboardSkeleton() {
  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-in fade-in duration-300">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <ShimmerBar className="h-3 w-24 mb-4" />
            <ShimmerBar className="h-9 w-16" />
          </div>
        ))}
      </div>
      {/* Activity List */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50">
          <ShimmerBar className="h-5 w-40" />
        </div>
        <div className="divide-y divide-slate-100">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="p-5 flex items-center justify-between">
              <div className="flex flex-col gap-2 w-2/3">
                <ShimmerBar className="h-4 w-48" />
                <ShimmerBar className="h-3 w-72" />
              </div>
              <div className="flex flex-col items-end gap-2">
                <ShimmerBar className="h-4 w-20" />
                <ShimmerBar className="h-1.5 w-24 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Table Skeleton (JSON Review, Downloads) ────────────────────── */
export function TableSkeleton({ columns = 6, rows = 5 }) {
  return (
    <>
      {[...Array(rows)].map((_, r) => (
        <tr key={r}>
          {[...Array(columns)].map((_, c) => (
            <td key={c} className="px-6 py-4">
              <ShimmerBar
                className={`h-4 ${
                  c === 0 ? 'w-8' : c === columns - 1 ? 'w-24' : 'w-full max-w-[180px]'
                }`}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/* ─── Sidebar List Skeleton (Bundle Review) ──────────────────────── */
export function SidebarListSkeleton({ items = 4 }) {
  return (
    <div className="divide-y divide-slate-100">
      {[...Array(items)].map((_, i) => (
        <div key={i} className="p-3 flex flex-col gap-2">
          <div className="flex justify-between items-start">
            <ShimmerBar className="h-4 w-32" />
            <ShimmerBar className="h-4 w-12 rounded-full" />
          </div>
          <ShimmerBar className="h-3 w-40" />
          <ShimmerBar className="h-2.5 w-28" />
        </div>
      ))}
    </div>
  );
}

/* ─── Error Logs Skeleton ────────────────────────────────────────── */
export function ErrorLogsSkeleton({ items = 3 }) {
  return (
    <div className="mx-auto space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <ShimmerBar className="h-7 w-32 mb-2" />
          <ShimmerBar className="h-3 w-64" />
        </div>
        <div className="flex gap-3">
          <ShimmerBar className="h-9 w-28 rounded-md" />
          <ShimmerBar className="h-9 w-28 rounded-md" />
        </div>
      </div>
      {/* Cards */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="divide-y divide-slate-100">
          {[...Array(items)].map((_, i) => (
            <div key={i} className="p-5">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex items-center gap-3">
                  <ShimmerBar className="h-10 w-10 rounded-lg" />
                  <div className="flex flex-col gap-2">
                    <ShimmerBar className="h-4 w-44" />
                    <ShimmerBar className="h-3 w-72" />
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <ShimmerBar className="h-5 w-16 rounded-full" />
                  <ShimmerBar className="h-3 w-32" />
                </div>
              </div>
              <ShimmerBar className="h-16 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Image Review Skeleton Panels ─────────────────────────────────── */
export function ImageReviewSkeletonPanels() {
  return (
    <>
      {/* Middle Panel */}
      <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
          <ShimmerBar className="h-5 w-36" />
          <ShimmerBar className="h-7 w-24 rounded-md" />
        </div>
        <div className="flex-1 bg-slate-100 p-6 flex items-center justify-center">
          <ShimmerBar className="h-[400px] w-full max-w-[500px] rounded-lg" />
        </div>
        <div className="border-t border-slate-200 p-5">
          <ShimmerBar className="h-3 w-28 mb-3" />
          <ShimmerBar className="h-24 w-full rounded-lg mb-4" />
          <div className="flex justify-end gap-2">
            <ShimmerBar className="h-9 w-24 rounded-lg" />
            <ShimmerBar className="h-9 w-32 rounded-lg" />
            <ShimmerBar className="h-9 w-28 rounded-lg" />
          </div>
        </div>
      </div>
      {/* Right Panel */}
      <div className="w-full md:w-[280px] shrink-0 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col md:h-full">
        <div className="p-4 border-b border-slate-100 bg-slate-50">
          <ShimmerBar className="h-3 w-28" />
        </div>
        <div className="flex-1 p-5">
          <div className="grid grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <ShimmerBar key={i} className="aspect-square rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── Image Queue Skeleton ───────────────────────────────────────── */
export function ImageQueueSkeleton() {
  return (
    <div className="h-[calc(100vh-6rem)] flex gap-6 overflow-hidden animate-in fade-in duration-300">
      {/* Left Panel */}
      <div className="w-1/4 min-w-[300px] bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        <div className="p-4 border-b border-slate-100 bg-slate-50">
          <ShimmerBar className="h-3 w-28 mb-2" />
          <ShimmerBar className="h-5 w-32" />
        </div>
        <div className="flex-1 p-3 space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-slate-50/30 rounded-xl p-3">
              <div className="flex justify-between items-center mb-3">
                <ShimmerBar className="h-4 w-36" />
                <ShimmerBar className="h-10 w-10 rounded-full" />
              </div>
              <div className="space-y-2">
                {[...Array(2)].map((_, j) => (
                  <div key={j} className="p-3 bg-white rounded-lg border border-slate-200">
                    <ShimmerBar className="h-3 w-24 mb-1.5" />
                    <ShimmerBar className="h-3 w-32" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <ImageReviewSkeletonPanels />
    </div>
  );
}

/* ─── Users Table Skeleton ───────────────────────────────────────── */
export function UsersTableSkeleton({ rows = 5 }) {
  return (
    <div className="divide-y divide-slate-100">
      {[...Array(rows)].map((_, r) => (
        <div key={r} className="px-6 py-4 flex items-center gap-6">
          <div className="flex items-center gap-3 flex-1">
            <ShimmerBar className="h-9 w-9 rounded-full" />
            <div className="flex flex-col gap-1.5">
              <ShimmerBar className="h-4 w-36" />
              <ShimmerBar className="h-3 w-48" />
            </div>
          </div>
          <ShimmerBar className="h-5 w-16 rounded-full" />
          <ShimmerBar className="h-4 w-16" />
          <ShimmerBar className="h-3 w-20" />
          <ShimmerBar className="h-6 w-6 rounded" />
        </div>
      ))}
    </div>
  );
}

/* ─── Downloads Table Skeleton ───────────────────────────────────── */
export function DownloadsTableSkeleton({ rows = 4 }) {
  return (
    <div className="divide-y divide-slate-100">
      {[...Array(rows)].map((_, r) => (
        <div key={r} className="px-6 py-4 flex items-center justify-between">
          <ShimmerBar className="h-4 w-40" />
          <div className="flex flex-col gap-1.5">
            <ShimmerBar className="h-4 w-48" />
            <ShimmerBar className="h-3 w-28" />
          </div>
          <div className="flex flex-col gap-1">
            <ShimmerBar className="h-3 w-24" />
            <ShimmerBar className="h-3 w-16" />
          </div>
          <ShimmerBar className="h-9 w-32 rounded-md" />
        </div>
      ))}
    </div>
  );
}

/* ─── Queue Sidebar Skeleton (CreateJob) ─────────────────────────── */
export function QueueSidebarSkeleton({ items = 5 }) {
  return (
    <div className="space-y-3">
      {[...Array(items)].map((_, i) => (
        <div key={i} className="bg-slate-50 border border-slate-100 p-3 rounded-md shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <ShimmerBar className="h-4 w-32" />
            <ShimmerBar className="h-4 w-14 rounded" />
          </div>
          <ShimmerBar className="h-3 w-full mb-2" />
          <ShimmerBar className="h-5 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/* ─── Task Logs Skeleton ─────────────────────────────────────────── */
export function TaskLogsSkeleton({ items = 4 }) {
  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {[...Array(items)].map((_, i) => (
        <div key={i} className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50">
            <div className="flex items-center gap-3">
              <ShimmerBar className="h-5 w-40" />
              <ShimmerBar className="h-5 w-16 rounded-full" />
            </div>
            <div className="flex items-center gap-4">
              <ShimmerBar className="h-5 w-24 rounded-full" />
              <ShimmerBar className="h-4 w-4" />
            </div>
          </div>
          <div className="p-4 space-y-3">
            {[...Array(2)].map((_, j) => (
              <div key={j} className="flex items-center justify-between p-4 border border-slate-100 rounded-lg shadow-sm">
                <div className="flex flex-col gap-2 flex-1">
                  <ShimmerBar className="h-4 w-64" />
                  <ShimmerBar className="h-3 w-full max-w-2xl" />
                </div>
                <div className="flex items-center gap-4 ml-6 shrink-0">
                  <ShimmerBar className="h-9 w-28 rounded-md" />
                  <ShimmerBar className="h-9 w-10 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
