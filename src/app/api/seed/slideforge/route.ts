import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { jsonError } from "@/lib/api/utils";

type ApiError = { step: string; message: string; details?: unknown };

export async function POST() {
  const supabase = supabaseServer();

  // 0) Make it safe to re-run:
  // If Slideforge already exists, reuse it instead of inserting a new one.
  const { data: existingCompany, error: existingCompanyError } = await supabase
    .from("companies")
    .select("*")
    .eq("name", "Slideforge")
    .maybeSingle();

  if (existingCompanyError) {
    return jsonError("api/seed/slideforge", "lookup_company", existingCompanyError);
  }

  let companyId: string;

  if (existingCompany) {
    companyId = existingCompany.id;
  } else {
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .insert({
        name: "Slideforge",
        website: "https://slideforge.ai",
        description:
          "Slideforge is an AI-powered presentation and storytelling tool that turns outlines or rough notes into polished professional slide decks.",
        posts_per_week: 3,
      })
      .select("id")
      .single();

    if (companyError || !company) {
      return jsonError("api/seed/slideforge", "insert_company", companyError);
    }

    companyId = company.id;
  }

  // 1) Subreddits
  const subreddits = ["r/PowerPoint", "r/ClaudeAI", "r/Canva"].map((name) => ({
    company_id: companyId,
    name,
  }));

  const { error: subredditsError } = await supabase.from("subreddits").upsert(subreddits, {onConflict: "company_id,name"});
  if (subredditsError) {
    return jsonError("api/seed/slideforge", "insert_subreddits", subredditsError);
  }

  // 2) Personas
  const personas = [
    { username: "riley_ops", bio: "Head of operations at a fast-growing SaaS startup." },
    { username: "jordan_consults", bio: "Independent consultant working with early-stage founders." },
    { username: "emily_econ", bio: "Economics student at a large public university." },
    { username: "alex_sells", bio: "Head of sales at a mid-market SaaS company." },
    { username: "priya_pm", bio: "Product manager at a tech company focused on internal tooling." },
  ].map((p) => ({
    company_id: companyId,
    username: p.username,
    bio: p.bio, // NOTE: must match your schema column name (your screenshot shows 'bio', not 'info')
  }));

  const { error: personasError } = await supabase.from("personas").upsert(personas, { onConflict: "company_id,username" });
  if (personasError) {
    return jsonError("api/seed/slideforge", "insert_personas", personasError);
  }

  // 3) Keywords (match your actual table: keywords(id, phrase))
  const keywords = [
    ["K1", "best ai presentation maker"],
    ["K2", "ai slide deck tool"],
    ["K3", "pitch deck generator"],
    ["K4", "alternatives to PowerPoint"],
    ["K5", "how to make slides faster"],
    ["K6", "design help for slides"],
    ["K7", "Canva alternative for presentations"],
    ["K8", "Claude vs Slideforge"],
    ["K9", "best tool for business decks"],
    ["K10", "automate my presentations"],
    ["K11", "need help with pitch deck"],
    ["K12", "tools for consultants"],
    ["K13", "tools for startups"],
    ["K14", "best ai design tool"],
    ["K15", "Google Slides alternative"],
    ["K16", "best storytelling tool"],
  ] as const;

  const { error: keywordsError } = await supabase
    .from("keywords")
    .upsert(
      keywords.map(([id, phrase]) => ({ id, phrase })),
      { onConflict: "id" }
    );

  if (keywordsError) {
    return jsonError("api/seed/slideforge", "upsert_keywords", keywordsError);
  }


  // 3b) Link keywords to company via join table
  const companyKeywordRows = keywords.map(([keyword_id]) => ({
    company_id: companyId,
    keyword_id,
  }));

  const { error: companyKeywordsError } = await supabase
    .from("company_keywords")
    .upsert(companyKeywordRows, { onConflict: "company_id,keyword_id" });

  if (companyKeywordsError) {
    return jsonError("api/seed/slideforge", "upsert_company_keywords", companyKeywordsError);
  }

  // 4) Insert (or reuse) a sample plan + posts + comments (with proper parent_comment_id mapping)
  try {
    const weekStartISO = new Date().toISOString().slice(0, 10);

    // Reuse existing plan for this company + week if present (idempotent)
    const { data: existingPlan, error: existingPlanError } = await supabase
      .from("plans")
      .select("id")
      .eq("company_id", companyId)
      .eq("week_start_date", weekStartISO)
      .maybeSingle();

    if (existingPlanError) return jsonError("api/seed/slideforge", "lookup_plan", existingPlanError);

    let planId: string;

    if (existingPlan) {
      planId = existingPlan.id;
    } else {
      const { data: planRow, error: planError } = await supabase
        .from("plans")
        .insert({ company_id: companyId, week_start_date: weekStartISO })
        .select("id")
        .single();

      if (planError || !planRow) return jsonError("api/seed/slideforge", "insert_plan", planError);
      planId = planRow.id;
    }

    // Remove any existing sample posts/comments for this plan so re-running is clean.
    const sampleTitles = ["Sample post A", "Sample post B"];

    const { data: oldPosts, error: oldPostsErr } = await supabase
      .from("posts")
      .select("id")
      .eq("plan_id", planId)
      .in("title", sampleTitles as string[]);

    if (oldPostsErr) return jsonError("api/seed/slideforge", "fetch_old_posts", oldPostsErr);

    if (oldPosts && oldPosts.length) {
      const oldPostIds = oldPosts.map((p: any) => p.id);

      const { error: deleteCommentsErr } = await supabase.from("comments").delete().in("post_id", oldPostIds);
      if (deleteCommentsErr) return jsonError("api/seed/slideforge", "delete_old_comments", deleteCommentsErr);

      const { error: deletePostsErr } = await supabase.from("posts").delete().in("id", oldPostIds);
      if (deletePostsErr) return jsonError("api/seed/slideforge", "delete_old_posts", deletePostsErr);
    }

    // insert two sample posts
    const samplePosts = [
      {
        plan_id: planId,
        subreddit: "r/PowerPoint",
        title: "Sample post A",
        body: "Body A",
        author_username: "riley_ops",
        scheduled_at: new Date().toISOString(),
        keyword_ids: [],
        status: "planned",
      },
      {
        plan_id: planId,
        subreddit: "r/Canva",
        title: "Sample post B",
        body: "Body B",
        author_username: "jordan_consults",
        scheduled_at: new Date(Date.now() + 1000 * 60).toISOString(),
        keyword_ids: [],
        status: "planned",
      },
    ];

    const { data: insertedPosts, error: insertPostsError } = await supabase.from("posts").insert(samplePosts).select("id");
    if (insertPostsError || !insertedPosts) return jsonError("api/seed/slideforge", "insert_posts", insertPostsError);

    // Map temp index to real post id
    const postIds = insertedPosts.map((r: any) => r.id);

    // Insert comments for first post: root -> reply -> reply-to-reply (sequential so parent_comment_id can be set)
    const commentsForPost0 = [
      { comment_text: "Root comment", username: "priya_pm", scheduled_at: new Date().toISOString() },
      { comment_text: "Reply to root", username: "jordan_consults", scheduled_at: new Date(Date.now() + 1000 * 60).toISOString(), parent_index: 0 },
      { comment_text: "Reply to reply", username: "emily_econ", scheduled_at: new Date(Date.now() + 1000 * 120).toISOString(), parent_index: 1 },
    ];

    const insertedCommentIdsByIndex = new Map<number, string>();

    for (let i = 0; i < commentsForPost0.length; i++) {
      const c = commentsForPost0[i];
      const parentIndex = (c as any).parent_index ?? null;
      const parentId = parentIndex === null ? null : insertedCommentIdsByIndex.get(parentIndex) ?? null;

      const { data: inserted, error } = await supabase
        .from("comments")
        .insert({
          post_id: postIds[0],
          parent_comment_id: parentId,
          comment_text: c.comment_text,
          username: c.username,
          scheduled_at: c.scheduled_at,
          status: "planned",
        })
        .select("id")
        .single();

      if (error) return jsonError("api/seed/slideforge", "insert_comments_sample", error);
      if (inserted && inserted.id) insertedCommentIdsByIndex.set(i, inserted.id);
    }

    // Insert a single root comment for post 1
    const { data: insertedC2, error: insertedC2Err } = await supabase
      .from("comments")
      .insert({ post_id: postIds[1], parent_comment_id: null, comment_text: "First comment on post B", username: "alex_sells", scheduled_at: new Date().toISOString(), status: "planned" })
      .select("id")
      .single();

    if (insertedC2Err) return jsonError("api/seed/slideforge", "insert_comments_sample2", insertedC2Err);
  } catch (err) {
    return jsonError("api/seed/slideforge", "seed_sample_plan", err as any);
  }


  return NextResponse.json({
    success: true,
    message: "Slideforge sample data seeded",
    company_id: companyId,
  });
}
