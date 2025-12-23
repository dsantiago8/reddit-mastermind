import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { generateWeekPlan } from "@/lib/planner/generateWeekPlan";
import { startOfWeekISO } from "@/lib/planner/utils";
import type { Company, Persona, Subreddit, Keyword } from "@/lib/planner/types";
import { jsonError, jsonErrorMessage } from "@/lib/api/utils";

/**
 * ⚠️ Update these if your join table is named differently.
 * From your Supabase sidebar it's something like `company_keyw...`.
 */
const COMPANY_KEYWORDS_TABLE = "company_keywords"; // <- change to your exact table name
const JOIN_COL_COMPANY_ID = "company_id";
const JOIN_COL_KEYWORD_ID = "keyword_id"; // <- some schemas call this `keyword_id` or `keyword`

type Body = {
  companyId?: string;
  weekStartISO?: string; // optional override
};

export async function GET() {
  const supabase = supabaseServer();

  const { data, error } = await supabase
    .from("plans")
    .select("id, company_id, week_start_date, created_at")
    .order("week_start_date", { ascending: false })
    .limit(25);

  if (error) {
    return jsonError("api/plans", "fetch_plans", error);
  }

  return NextResponse.json({ plans: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = supabaseServer();

  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    // allow empty body
  }

  // 1) Determine company
  let company: Company | null = null;

  if (body.companyId) {
    const { data, error } = await supabase
      .from("companies")
      .select("*")
      .eq("id", body.companyId)
      .single();

    if (error) {
      return jsonError("api/plans", "fetch_company_by_id", error);
    }
    company = data as Company;
  } else {
    // default to Slideforge if not provided
    const { data, error } = await supabase
      .from("companies")
      .select("*")
      .eq("name", "Slideforge")
      .maybeSingle();

    if (error) {
      return jsonError("api/plans", "fetch_company_by_name", error);
    }
    company = (data as Company) ?? null;
  }

  if (!company) {
    return NextResponse.json(
      { error: { step: "company_missing", message: "No company found. Provide companyId." } },
      { status: 400 }
    );
  }

  // 2) Determine week start
  const weekStart = body.weekStartISO ? new Date(body.weekStartISO) : startOfWeekISO(new Date());
  const weekStartISO = weekStart.toISOString().slice(0, 10); // YYYY-MM-DD

  // 3) Fetch personas
  const { data: personasData, error: personasError } = await supabase
    .from("personas")
    .select("*")
    .eq("company_id", company.id);

  if (personasError) {
    return jsonError("api/plans", "fetch_personas", personasError);
  }

  const personas = (personasData as Persona[]) ?? [];
  if (personas.length < 2) {
    return NextResponse.json(
      { error: { step: "not_enough_personas", message: "Need at least 2 personas." } },
      { status: 400 }
    );
  }

  // 4) Fetch subreddits
  const { data: subredditsData, error: subredditsError } = await supabase
    .from("subreddits")
    .select("*")
    .eq("company_id", company.id);

  if (subredditsError) {
    return jsonError("api/plans", "fetch_subreddits", subredditsError);
  }

  const subreddits = (subredditsData as Subreddit[]) ?? [];
  if (subreddits.length < 1) {
    return NextResponse.json(
      { error: { step: "no_subreddits", message: "Need at least 1 subreddit." } },
      { status: 400 }
    );
  }

  // 5) Fetch keywords via join table
  const { data: joinRows, error: joinError } = await supabase
    .from(COMPANY_KEYWORDS_TABLE)
    .select("*")
    .eq(JOIN_COL_COMPANY_ID, company.id);

  if (joinError) {
    return jsonError("api/plans", "fetch_company_keywords_join", joinError);
  }

  const keywordIds: string[] =
    (joinRows ?? [])
      .map((r: any) => r[JOIN_COL_KEYWORD_ID])
      .filter(Boolean);

  if (keywordIds.length < 1) {
    return NextResponse.json(
      { error: { step: "no_keywords", message: "No keywords linked to this company." } },
      { status: 400 }
    );
  }

  const { data: keywordsData, error: keywordsError } = await supabase
    .from("keywords")
    .select("id, phrase")
    .in("id", keywordIds);

  if (keywordsError) {
    return jsonError("api/plans", "fetch_keywords", keywordsError);
  }

  const keywords: Keyword[] = (keywordsData ?? []).map((k: any) => ({
    id: k.id,
    phrase: k.phrase,
  }));

  // 6) Prevent duplicate plan for the same week + company (unique constraint exists)
  const { data: existingPlan, error: existingPlanError } = await supabase
    .from("plans")
    .select("id")
    .eq("company_id", company.id)
    .eq("week_start_date", weekStartISO)
    .maybeSingle();

  if (existingPlanError) {
    return jsonError("api/plans", "check_existing_plan", existingPlanError);
  }

  if (existingPlan?.id) {
    return NextResponse.json(
      { success: true, reused: true, planId: existingPlan.id, weekStart: weekStartISO },
      { status: 200 }
    );
  }

  // 7) Create plan row
  const { data: planRow, error: planError } = await supabase
    .from("plans")
    .insert({
      company_id: company.id,
      week_start_date: weekStartISO,
    })
    .select("*")
    .single();

  if (planError || !planRow) {
    return jsonError("api/plans", "insert_plan", planError);
  }

  const planId = planRow.id as string;

  // 8) Pull recent usage to reduce repetition (last 3 plans)
  const { data: recentPosts, error: recentPostsError } = await supabase
    .from("posts")
    .select("subreddit, keyword_ids, plans!inner(company_id)")
    // inner join through plan
    // NOTE: PostgREST inner join syntax differs by schema; this may fail if relationship not configured.
    // If it fails, we just skip "recent" heuristics.
    .eq("plans.company_id", company.id)
    .order("scheduled_at", { ascending: false })
    .limit(40);

  let recentKeywordIds: string[] = [];
  let recentSubreddits: string[] = [];

  if (!recentPostsError && Array.isArray(recentPosts)) {
    for (const p of recentPosts as any[]) {
      if (Array.isArray(p.keyword_ids)) recentKeywordIds.push(...p.keyword_ids);
      if (p.subreddit) recentSubreddits.push(p.subreddit);
    }
  }

  recentKeywordIds = Array.from(new Set(recentKeywordIds)).slice(0, 30);
  recentSubreddits = Array.from(new Set(recentSubreddits)).slice(0, 10);

  // 9) Generate week content
  const generated = generateWeekPlan({
    company: {
      id: company.id,
      name: company.name,
      website: (company as any).website ?? null,
      description: company.description,
      posts_per_week: company.posts_per_week,
    },
    personas,
    subreddits,
    keywords,
    recentKeywordIds,
    recentSubreddits,
    weekStart,
  });

  // 10) Insert posts
  const { data: insertedPosts, error: insertPostsError } = await supabase
    .from("posts")
    .insert(
      generated.posts.map((p) => ({
        plan_id: planId,
        subreddit: p.subreddit,
        title: p.title,
        body: p.body,
        author_username: p.author_username,
        scheduled_at: p.scheduled_at,
        keyword_ids: p.keyword_ids,
        status: "planned",
      }))
    )
    .select("id");

  if (insertPostsError || !insertedPosts) {
    return NextResponse.json(
      {
        error: {
          step: "insert_posts",
          message: insertPostsError?.message ?? "Unknown error",
          details: insertPostsError,
        },
      },
      { status: 500 }
    );
  }

  // Map temp post index -> real post id
  const postIdByTempIndex = new Map<number, string>();
  insertedPosts.forEach((row: any, idx: number) => {
    postIdByTempIndex.set(idx, row.id);
  });

  // 11) Insert comments (needs parent mapping)
  // We'll insert per-post in chronological order so parent ids exist.
  const allCommentsToInsert: any[] = [];
  for (let p = 0; p < generated.posts.length; p++) {
    const realPostId = postIdByTempIndex.get(p);
    if (!realPostId) continue;

    const perPost = generated.comments
      .filter((c) => c.post_temp_index === p)
      .map((c, idx) => ({ ...c, local_index: idx }))
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

    // parent mapping: generated.parent_temp_index refers to index in the global "comments" array
    // Our generator uses "parent_temp_index" as absolute index in the comments list at creation time.
    // We'll instead resolve parents within the inserted order by tracking inserted comment ids by global index.
    // To keep things robust, we do a two-pass:
    // 1) insert root-level comments first (parent null)
    // 2) then insert replies
    // BUT: simplest for take-home: insert sequentially and map as we go when parent is already inserted.

    const insertedCommentIdsByGlobalIndex = new Map<number, string>();

    // We need the original global index in generated.comments. Compute it and insert sequentially
    const globalIndexes = generated.comments
      .map((c, idx) => ({ c, idx }))
      .filter((x) => x.c.post_temp_index === p)
      .sort((a, b) => new Date(a.c.scheduled_at).getTime() - new Date(b.c.scheduled_at).getTime());

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
        return jsonError("api/plans", "insert_comments", error);
      }

      if (inserted && inserted.id) insertedCommentIdsByGlobalIndex.set(globalIdx, inserted.id);
    }
  }

  return NextResponse.json({
    success: true,
    reused: false,
    planId,
    weekStart: weekStartISO,
    counts: { posts: generated.posts.length, comments: generated.comments.length },
  });
}
