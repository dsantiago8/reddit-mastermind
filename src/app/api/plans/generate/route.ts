import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { generateWeekPlan } from "@/lib/planner/generateWeekPlan";
import { jsonError, jsonErrorMessage, logError } from "@/lib/api/utils";


/**
 * POST /api/plans/generate
 *
 * Body (optional):
 * {
 *   companyId?: string
 *   weekStart?: string (YYYY-MM-DD)
 * }
 */
export async function POST(req: NextRequest) {
  const supabase = supabaseServer();

  function logError(step: string, err: any) {
    // compact, consistent server-side logging for easier debugging
    console.error(`[api/plans/generate] ${step}:`, err);
  }

  let body: {
    companyId?: string;
    weekStart?: string;
  } = {};

  try {
    body = await req.json();
  } catch {
    // body is optional
  }

  /**
   * 1. Resolve company
   */
  let companyId = body.companyId;

  if (!companyId) {
    const { data: company, error } = await supabase
      .from("companies")
      .select("id")
      .limit(1)
      .single();

    if (error || !company) {
      return NextResponse.json(
        { error: "No company found to generate plan for" },
        { status: 400 }
      );
    }

    companyId = company.id;
  }

  /**
   * 2. Resolve week start (Monday)
   */
  const weekStart =
    body.weekStart ??
    new Date(
      new Date().setDate(
        new Date().getDate() - new Date().getDay() + 1
      )
    )
      .toISOString()
      .slice(0, 10);

  /**
   * 3. Prevent duplicate plans for same week
   */
  const { data: existingPlan } = await supabase
    .from("plans")
    .select("id")
    .eq("company_id", companyId)
    .eq("week_start_date", weekStart)
    .maybeSingle();

  if (existingPlan) {
    return NextResponse.json(
      { error: "Plan already exists for this week" },
      { status: 409 }
    );
  }

  /**
   * 4. Fetch data required by generator and build inputs
   */
  const { data: companyData, error: companyErr } = await supabase
    .from("companies")
    .select("*")
    .eq("id", companyId)
    .single();

  if (companyErr || !companyData) {
    return jsonErrorMessage("api/plans/generate", "fetch_company", "Company not found", 400);
  }

  const { data: personasData, error: personasErr } = await supabase
    .from("personas")
    .select("*")
    .eq("company_id", companyId);

  if (personasErr) {
    return jsonError("api/plans/generate", "fetch_personas", personasErr);
  }

  const { data: subredditsData, error: subredditsErr } = await supabase
    .from("subreddits")
    .select("*")
    .eq("company_id", companyId);

  if (subredditsErr) {
    return jsonError("api/plans/generate", "fetch_subreddits", subredditsErr);
  }

  // Fetch keywords via join table (common pattern for this repo)
  const { data: joinRows, error: joinErr } = await supabase
    .from("company_keywords")
    .select("*")
    .eq("company_id", companyId);

  if (joinErr) {
    return jsonError("api/plans/generate", "fetch_company_keywords_join", joinErr);
  }

  const keywordIds: string[] = (joinRows ?? []).map((r: any) => r.keyword_id).filter(Boolean);

  const { data: keywordsData, error: keywordsErr } = await supabase
    .from("keywords")
    .select("id, phrase")
    .in("id", keywordIds);

  if (keywordsErr) {
    return jsonError("api/plans/generate", "fetch_keywords", keywordsErr);
  }

  const company = {
    id: companyData.id,
    name: companyData.name,
    website: (companyData as any).website ?? null,
    description: companyData.description,
    posts_per_week: companyData.posts_per_week,
  };

  const personas = (personasData as any[]) ?? [];
  const subreddits = (subredditsData as any[]) ?? [];
  const keywords = (keywordsData as any[]) ?? [];

  if (personas.length < 1 || subreddits.length < 1 || keywords.length < 1) {
    return jsonErrorMessage("api/plans/generate", "not_enough_data", "Not enough data to generate plan", 400);
  }

  const generated = generateWeekPlan({
    company,
    personas,
    subreddits,
    keywords,
    recentKeywordIds: [],
    recentSubreddits: [],
    weekStart: new Date(weekStart),
  });

  /**
   * 5. Insert plan
   */
  const { data: plan, error: planErr } = await supabase
    .from("plans")
    .insert({
      company_id: companyId,
      week_start_date: weekStart,
    })
    .select()
    .single();

  if (planErr || !plan) {
    return jsonError("api/plans/generate", "insert_plan", planErr);
  }

  /**
   * 6. Insert posts
   */
  const { data: posts, error: postsErr } = await supabase
    .from("posts")
    .insert(
      generated.posts.map((p) => ({
        ...p,
        plan_id: plan.id,
      }))
    )
    .select();

  if (postsErr) {
    return jsonError("api/plans/generate", "insert_posts", postsErr);
  }

  /**
   * 7. Insert comments
   */
  // 7) Insert comments per-post, preserving parent->child relationships
  for (let p = 0; p < generated.posts.length; p++) {
    const realPostId = posts?.[p]?.id;
    if (!realPostId) continue;

    // Collect comments for this post in chronological order
    const globalIndexes = generated.comments
      .map((c, idx) => ({ c, idx }))
      .filter((x) => x.c.post_temp_index === p)
      .sort((a, b) => new Date(a.c.scheduled_at).getTime() - new Date(b.c.scheduled_at).getTime());

    if (globalIndexes.length === 0) continue;

    const insertedCommentIdsByGlobalIndex = new Map<number, string>();

    // Insert sequentially so replies can reference parents inserted earlier
    for (const item of globalIndexes) {
      const c = item.c;
      const globalIdx = item.idx;
      const parentGlobalIdx = c.parent_temp_index;

      const parentId = parentGlobalIdx === null ? null : insertedCommentIdsByGlobalIndex.get(parentGlobalIdx) ?? null;

      const { data: inserted, error } = await supabase
        .from("comments")
        .insert({
          post_id: realPostId,
          parent_comment_id: parentId,
          comment_text: c.comment_text,
          username: c.username,
          scheduled_at: c.scheduled_at,
          status: "planned",
        })
        .select("id")
        .single();

      if (error) {
        return jsonError("api/plans/generate", "insert_comments", error);
      }

      if (inserted && inserted.id) insertedCommentIdsByGlobalIndex.set(globalIdx, inserted.id);
    }
  }

  /**
   * 8. Success
   */
  return NextResponse.json({
    planId: plan.id,
    weekStart,
  });
}

