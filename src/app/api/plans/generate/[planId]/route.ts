import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { jsonError, logError } from "@/lib/api/utils";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ planId: string }> }) {
  const supabase = supabaseServer();
  const { planId } = await ctx.params;

  const { data: plan, error: planErr } = await supabase
    .from("plans")
    .select("*")
    .eq("id", planId)
    .single();

  if (planErr) {
    return jsonError("api/plans/generate/[planId]", "fetch_plan", planErr);
  }

  const { data: posts, error: postsErr } = await supabase
    .from("posts")
    .select("*")
    .eq("plan_id", planId)
    .order("scheduled_at", { ascending: true });

  if (postsErr) {
    return jsonError("api/plans/generate/[planId]", "fetch_posts", postsErr);
  }

  const postIds = (posts ?? []).map((p: any) => p.id);

  const { data: comments, error: commentsErr } = await supabase
    .from("comments")
    .select("*")
    .in("post_id", postIds)
    .order("scheduled_at", { ascending: true });

  if (commentsErr) {
    return jsonError("api/plans/generate/[planId]", "fetch_comments", commentsErr);
  }

  return NextResponse.json({ plan, posts: posts ?? [], comments: comments ?? [] });
}
