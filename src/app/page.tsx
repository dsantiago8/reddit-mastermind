"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type PlanRow = {
  id: string;
  company_id: string;
  week_start_date: string; // "YYYY-MM-DD"
  created_at: string;
};

function startOfWeekMondayISO(date: Date) {
  // Monday as week start
  const d = new Date(date);
  const day = d.getDay(); // 0 Sun ... 6 Sat
  const diffToMonday = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diffToMonday);
  d.setHours(0, 0, 0, 0);
  return d; // Date at Monday 00:00 local
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export default function DashboardPage() {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);

  const [busy, setBusy] = useState<null | "this" | "next">(null);
  const [error, setError] = useState<string | null>(null);

  const thisWeekStart = useMemo(() => startOfWeekMondayISO(new Date()), []);
  const nextWeekStart = useMemo(() => addDays(thisWeekStart, 7), [thisWeekStart]);

  async function fetchPlans() {
    setLoadingPlans(true);
    setError(null);

    try {
      const res = await fetch("/api/plans", { method: "GET" });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Failed to fetch plans (${res.status})`);
      }
      const json = await res.json();
      setPlans(json.plans ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error while fetching plans");
    } finally {
      setLoadingPlans(false);
    }
  }

  useEffect(() => {
    fetchPlans();
  }, []);

  async function generatePlan(kind: "this" | "next") {
    setBusy(kind);
    setError(null);

    const weekStartISO =
      kind === "this"
        ? thisWeekStart.toISOString()
        : nextWeekStart.toISOString();

    try {
      const res = await fetch("/api/plans/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // If your generate endpoint doesn't need weekStartISO for "this week",
        // you can still send it—it's fine.
        body: JSON.stringify({ weekStartISO }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg =
          json?.error?.message ||
          json?.error ||
          `Generate failed (${res.status})`;
        throw new Error(msg);
      }

      // Refresh list
      await fetchPlans();

      // Optional: jump straight to the new plan
      const planId = json?.planId as string | undefined;
      if (planId) {
        window.location.href = `/plans/${planId}`;
      }
    } catch (e: any) {
      setError(e?.message ?? "Unknown error while generating plan");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            Reddit Content Planner
          </h1>
          <p className="text-sm text-neutral-400">
            Generate a weekly plan (posts + threaded comments) from company info,
            personas, subreddits, and keyword targets.
          </p>
        </header>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="text-sm text-neutral-300">
                This week starts:{" "}
                <span className="font-mono text-neutral-200">
                  {thisWeekStart.toISOString().slice(0, 10)}
                </span>
              </div>
              <div className="text-sm text-neutral-300">
                Next week starts:{" "}
                <span className="font-mono text-neutral-200">
                  {nextWeekStart.toISOString().slice(0, 10)}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                onClick={() => generatePlan("this")}
                disabled={busy !== null}
                className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm hover:bg-neutral-800 disabled:opacity-60"
              >
                {busy === "this" ? "Generating..." : "Generate this week"}
              </button>

              <button
                onClick={() => generatePlan("next")}
                disabled={busy !== null}
                className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm hover:bg-neutral-800 disabled:opacity-60"
              >
                {busy === "next" ? "Generating..." : "Generate next week"}
              </button>

              <button
                onClick={fetchPlans}
                disabled={busy !== null || loadingPlans}
                className="rounded-xl border border-neutral-800 bg-transparent px-4 py-2 text-sm hover:bg-neutral-900 disabled:opacity-60"
              >
                Refresh
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-200">
              {error}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent plans</h2>
            <span className="text-xs text-neutral-500">
              Click a plan to view posts + comments
            </span>
          </div>

          {loadingPlans ? (
            <div className="text-sm text-neutral-400">Loading…</div>
          ) : plans.length === 0 ? (
            <div className="text-sm text-neutral-400">
              No plans yet. Click “Generate this week”.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-neutral-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-neutral-900">
                  <tr>
                    <th className="px-4 py-3 font-medium text-neutral-200">
                      Week start
                    </th>
                    <th className="px-4 py-3 font-medium text-neutral-200">
                      Plan ID
                    </th>
                    <th className="px-4 py-3 font-medium text-neutral-200">
                      Created
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((p) => (
                    <tr
                      key={p.id}
                      className="border-t border-neutral-800 hover:bg-neutral-900/60"
                    >
                      <td className="px-4 py-3 font-mono text-neutral-200">
                        <Link
                          href={`/plans/${p.id}`}
                          className="hover:underline"
                        >
                          {p.week_start_date}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-mono text-neutral-400">
                        <Link
                          href={`/plans/${p.id}`}
                          className="hover:underline"
                        >
                          {p.id}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-neutral-400">
                        {new Date(p.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <footer className="text-xs text-neutral-500">
          Tip: “Generate next week” simulates the cron button you described in
          the prompt.
        </footer>
      </div>
    </main>
  );
}
