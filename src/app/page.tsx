"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type PlanRow = {
  id: string;
  company_id: string;
  week_start_date: string; // "YYYY-MM-DD"
  created_at: string;
};

type PlanDetails = {
  plan: any;
  posts: Array<any>;
  comments: Array<any>;
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
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [planDetails, setPlanDetails] = useState<PlanDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null);

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

  async function fetchPlanDetails(id: string) {
    setLoadingDetails(true);
    setError(null);
    // mark the selected plan immediately so the UI filters by this id
    setSelectedPlanId(id);
    setPlanDetails(null);
    try {
      const res = await fetch(`/api/plans/generate/${id}`, { method: "GET" });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Failed to fetch plan (${res.status})`);
      }
      const json = await res.json();
      setPlanDetails({ plan: json.plan, posts: json.posts ?? [], comments: json.comments ?? [] });
      setSelectedPlanId(id);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error while fetching plan details");
    } finally {
      setLoadingDetails(false);
    }
  }

  async function generatePlan(kind: "this" | "next") {
    setBusy(kind);
    setError(null);

    // send date-only string (YYYY-MM-DD) to match backend expectations
    try {
      if (kind === "this") {
        const weekStart = thisWeekStart.toISOString().slice(0, 10);
        const res = await fetch("/api/plans/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ weekStart }),
        });

        const text = await res.text().catch(() => "");
        let json: any = {};
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          // ignore parse error
        }

        if (!res.ok) {
          const msg = json?.error?.message || json?.error || text || `Generate failed (${res.status})`;
          throw new Error(msg);
        }

        await fetchPlans();
        const planId = json?.planId as string | undefined;
        if (planId) await fetchPlanDetails(planId);
      } else {
        // kind === "next" : find the next available week (no existing plan)
        // NOTE: remove small fixed cap so users can keep generating; use a very large
        // safety limit to avoid infinite loops in extreme edge cases.
        let candidate = new Date(nextWeekStart);
        let createdPlanId: string | null = null;
        let attempts = 0;
        const SAFETY_LIMIT = 1000; // ~19 years worth of weeks

        while (true) {
          const weekStart = candidate.toISOString().slice(0, 10);

          const res = await fetch("/api/plans/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ weekStart }),
          });

          const text = await res.text().catch(() => "");
          let json: any = {};
          try {
            json = text ? JSON.parse(text) : {};
          } catch {
            // ignore
          }

          if (!res.ok) {
            // Treat 409 as "already exists" (another plan exists for this week).
            // Advance to the next week in that case instead of failing the whole loop.
            if (res.status === 409) {
              candidate.setDate(candidate.getDate() + 7);
              attempts += 1;
              if (attempts >= SAFETY_LIMIT) break;
              continue;
            }

            const msg = json?.error?.message || json?.error || text || `Generate failed (${res.status})`;
            throw new Error(msg);
          }

          // If the API created a new plan it should return a planId in the body.
          // Older variants of the API returned { success, reused } — support either shape.
          if (json?.planId) {
            createdPlanId = json.planId;
            break;
          }

          if (json?.success === true && json?.reused === false && json?.planId) {
            createdPlanId = json.planId;
            break;
          }

          // If we get here the API responded OK but didn't return a planId; advance week.
          candidate.setDate(candidate.getDate() + 7);
          attempts += 1;

          // Otherwise advance one week and try again
          candidate.setDate(candidate.getDate() + 7);
          attempts += 1;
          if (attempts >= SAFETY_LIMIT) break;
        }

        if (createdPlanId) {
          await fetchPlans();
          await fetchPlanDetails(createdPlanId);
        } else if (attempts >= SAFETY_LIMIT) {
          throw new Error(`Tried ${SAFETY_LIMIT} weeks ahead without finding a free week; stopping to avoid runaway loop.`);
        } else {
          throw new Error("Could not find an empty week to generate");
        }
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

        <section className="rounded-2xl border border-neutral-700 bg-neutral-900 p-5 panel-soft">
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
                className="rounded-md border border-neutral-600 bg-neutral-800 px-4 py-2 text-sm hover:bg-neutral-700 disabled:opacity-60"
              >
                {busy === "this" ? "Generating..." : "Generate this week"}
              </button>

              <button
                onClick={() => generatePlan("next")}
                disabled={busy !== null}
                className="rounded-md border border-neutral-600 bg-neutral-800 px-4 py-2 text-sm hover:bg-neutral-700 disabled:opacity-60"
              >
                {busy === "next" ? "Generating..." : "Generate next week"}
              </button>

              <button
                onClick={fetchPlans}
                disabled={busy !== null || loadingPlans}
                className="rounded-md border border-neutral-700 bg-transparent px-4 py-2 text-sm hover:bg-neutral-800 disabled:opacity-60"
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

        <section className="rounded-2xl border border-neutral-700 bg-neutral-900 p-5 panel-soft">
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
              <div className="overflow-hidden rounded-xl border border-neutral-700">
              <table className="w-full text-left text-sm">
                <thead className="bg-neutral-800">
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
                    <th className="px-4 py-3 font-medium text-neutral-200 text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((p) => {
                    const isSelected = p.id === selectedPlanId;
                    return (
                      <tr
                        key={p.id}
                        className={`border-t border-neutral-700 hover:bg-neutral-800/30 ${isSelected ? "bg-neutral-800 border-l-4 border-l-amber-400" : ""}`}
                      >
                        <td className={isSelected ? "px-4 py-3 font-mono text-neutral-100" : "px-4 py-3 font-mono text-neutral-200"}>
                          <button
                            onClick={() => fetchPlanDetails(p.id)}
                            className="hover:underline text-left w-full cursor-pointer"
                          >
                            {p.week_start_date}
                          </button>
                        </td>
                        <td className={isSelected ? "px-4 py-3 font-mono text-neutral-100" : "px-4 py-3 font-mono text-neutral-400"}>
                          <button
                            onClick={() => fetchPlanDetails(p.id)}
                            className="hover:underline text-left w-full cursor-pointer"
                          >
                            {p.id}
                          </button>
                        </td>
                        <td className={isSelected ? "px-4 py-3 text-neutral-200" : "px-4 py-3 text-neutral-400"}>
                          {new Date(p.created_at).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={async () => {
                              // confirm then delete
                              if (!confirm(`Delete plan ${p.week_start_date} (${p.id})? This will remove posts and comments.`)) return;
                              setDeletingPlanId(p.id);
                              setError(null);
                              try {
                                const res = await fetch(`/api/plans/${p.id}`, { method: "DELETE" });
                                const text = await res.text().catch(() => "");
                                let json: any = {};
                                try {
                                  json = text ? JSON.parse(text) : {};
                                } catch {}

                                if (!res.ok) {
                                  throw new Error(json?.error || text || `Delete failed (${res.status})`);
                                }

                                // refresh list and clear details if needed
                                await fetchPlans();
                                if (selectedPlanId === p.id) {
                                  setSelectedPlanId(null);
                                  setPlanDetails(null);
                                }
                              } catch (e: any) {
                                setError(e?.message ?? "Unknown error while deleting plan");
                              } finally {
                                setDeletingPlanId(null);
                              }
                            }}
                            disabled={deletingPlanId === p.id}
                            className="rounded-md px-3 py-1 text-xs bg-red-600 hover:bg-red-500 disabled:opacity-60"
                          >
                            {deletingPlanId === p.id ? "Deleting..." : "Delete"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Plan details panel */}
        {selectedPlanId && 
          <section className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Plan details</h2>
              <div className="text-sm text-neutral-400">{loadingDetails ? "Loading…" : ""}</div>
            </div>

            {error && (
              <div className="mt-2 rounded-xl border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-200">
                {error}
              </div>
            )}

            {!planDetails && !loadingDetails ? (
              <div className="text-sm text-neutral-400">No details loaded.</div>
            ) : planDetails ? (
              <div className="space-y-4">
                  {/* Quality removed */}

                <div>
                  <h3 className="font-medium">Posts</h3>
                  <div className="space-y-3">
                    {(() => {
                      const currentPlanId = planDetails.plan?.id ?? selectedPlanId;
                      return planDetails.posts.filter((p: any) => p.plan_id === currentPlanId).map((post: any, idx: number) => (
                      <div key={idx} className="rounded-md border border-neutral-800 p-3">
                        <div className="font-medium">{post.title}</div>
                        <div className="text-xs text-neutral-400">{post.subreddit} — {post.scheduled_at} {post.author_username ? `— by ${post.author_username}` : null}</div>
                        <div className="mt-2 text-sm text-neutral-300 whitespace-pre-wrap">{post.body}</div>

                        {/* Comments for this post (grouped + nested) */}
                        <div className="mt-3">
                          <h4 className="font-medium">Comments</h4>
                          <div className="space-y-2 text-sm text-neutral-300">
                            {(() => {
                              const allComments = planDetails.comments ?? [];
                              const comments = allComments.filter((c: any) => c.post_id === post.id).map((c: any, i: number) => ({ ...c, __idx: i }));

                              const byId: Record<string, any> = {};
                              for (const c of comments) {
                                if (c.id) byId[c.id] = { ...c, children: [] };
                              }

                              const originalById: Record<string, any> = {};
                              for (const c of comments) if (c.id) originalById[c.id] = c;

                              const roots: any[] = [];
                              for (const c of comments) {
                                const node = c.id ? byId[c.id] : { ...c, children: [] };
                                const parentId = c.parent_comment_id;
                                if (parentId && byId[parentId]) {
                                  byId[parentId].children.push(node);
                                } else {
                                  roots.push(node);
                                }
                              }

                              const sortRec = (arr: any[]) => {
                                arr.sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
                                for (const x of arr) if (x.children) sortRec(x.children);
                              };

                              sortRec(roots);

                              const CommentNode = ({ node, depth = 0 }: { node: any; depth?: number }) => (
                                <div style={{ marginLeft: depth * 18 }} className="mb-2">
                                  <div className="rounded-md border border-neutral-800 p-2">
                                    <div className="text-xs text-neutral-400">{node.username} — {node.scheduled_at}</div>

                                    {node.parent_comment_id && depth === 0 && originalById[node.parent_comment_id] && (
                                      <div className="mt-1 mb-2 rounded-sm border border-neutral-800/60 bg-neutral-900 p-2 text-xs text-neutral-400">
                                        <div className="font-medium text-neutral-300">In reply to</div>
                                        <div className="mt-1 whitespace-pre-wrap">{originalById[node.parent_comment_id].comment_text}</div>
                                      </div>
                                    )}

                                    <div className="mt-1 whitespace-pre-wrap">{node.comment_text}</div>
                                  </div>
                                  {node.children && node.children.length > 0 && (
                                    <div className="mt-2 space-y-2">
                                      {node.children.map((ch: any) => (
                                        <CommentNode key={ch.id ?? ch.__idx} node={ch} depth={depth + 1} />
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );

                              return roots.length > 0 ? roots.map((r) => <CommentNode key={r.id ?? r.__idx} node={r} depth={0} />) : <div className="text-sm text-neutral-500">No comments yet.</div>;
                            })()}
                          </div>
                        </div>
                      </div>
                    ))})()}
                 </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-neutral-400">Loading…</div>
            )}
          </section>
        }

      </div>
    </main>
  );
}
