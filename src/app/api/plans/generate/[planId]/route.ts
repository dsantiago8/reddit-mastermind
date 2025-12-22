import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(_req: NextRequest, ctx: { params: { planId: string } }) {
  const supabase = supabaseServer();
  const planId = ctx.params.planId;

  const { data: plan, error: planErr } = await supabase
    .from("plans")
    .select("*")
    .eq("id", planId)
    .single();

  if (planErr) return NextResponse.json({ error: planErr.message }, { status: 500 });

  const { data: posts, error: postsErr } = await supabase
    .from("posts")
    .select("*")
    .eq("plan_id", planId)
    .order("scheduled_at", { ascending: true });

  if (postsErr) return NextResponse.json({ error: postsErr.message }, { status: 500 });

  const postIds = (posts ?? []).map((p: any) => p.id);

  const { data: comments, error: commentsErr } = await supabase
    .from("comments")
    .select("*")
    .in("post_id", postIds)
    .order("scheduled_at", { ascending: true });

  if (commentsErr) return NextResponse.json({ error: commentsErr.message }, { status: 500 });

  const { data: quality, error: qualityErr } = await supabase
    .from("quality_reports")
    .select("*")
    .eq("plan_id", planId)
    .maybeSingle();

  if (qualityErr) return NextResponse.json({ error: qualityErr.message }, { status: 500 });

  return NextResponse.json({ plan, posts: posts ?? [], comments: comments ?? [], quality: quality ?? null });
}
