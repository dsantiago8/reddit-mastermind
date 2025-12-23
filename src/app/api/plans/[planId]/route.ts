import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { jsonErrorMessage, jsonError } from "@/lib/api/utils";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ planId: string }> }) {
  const supabase = supabaseServer();
  const { planId } = await ctx.params;

  if (!planId) {
    return jsonErrorMessage("api/plans/[planId]", "missing_param", "planId is required", 400);
  }

  // verify plan exists
  const { data: plan, error: planErr } = await supabase.from("plans").select("id").eq("id", planId).maybeSingle();
  if (planErr) return jsonError("api/plans/[planId]", "fetch_plan", planErr);
  if (!plan) return jsonErrorMessage("api/plans/[planId]", "not_found", "Plan not found", 404);

  try {
    // 1) fetch post ids for this plan
    const { data: posts, error: postsErr } = await supabase.from("posts").select("id").eq("plan_id", planId);
    if (postsErr) return jsonError("api/plans/[planId]", "fetch_posts", postsErr);

    const postIds: string[] = (posts ?? []).map((p: any) => p.id).filter(Boolean);

    // 2) delete comments belonging to those posts
    if (postIds.length > 0) {
      const { error: delCommentsErr } = await supabase.from("comments").delete().in("post_id", postIds);
      if (delCommentsErr) return jsonError("api/plans/[planId]", "delete_comments", delCommentsErr);
    }

    // 3) delete posts for the plan
    const { error: delPostsErr } = await supabase.from("posts").delete().eq("plan_id", planId);
    if (delPostsErr) return jsonError("api/plans/[planId]", "delete_posts", delPostsErr);

    // 4) delete the plan
    const { error: delPlanErr } = await supabase.from("plans").delete().eq("id", planId);
    if (delPlanErr) return jsonError("api/plans/[planId]", "delete_plan", delPlanErr);

    return NextResponse.json({ success: true, planId });
  } catch (err: any) {
    return jsonError("api/plans/[planId]", "unexpected", err);
  }
}
