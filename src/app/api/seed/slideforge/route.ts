import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

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
    return NextResponse.json(
      { error: { step: "lookup_company", message: existingCompanyError.message } as ApiError },
      { status: 500 }
    );
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
      return NextResponse.json(
        { error: { step: "insert_company", message: companyError?.message ?? "Unknown error" } as ApiError },
        { status: 500 }
      );
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
    return NextResponse.json(
      {
        error: {
          step: "insert_subreddits",
          message: subredditsError.message,
          details: subredditsError,
        } as ApiError,
      },
      { status: 500 }
    );
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
    return NextResponse.json(
      {
        error: {
          step: "insert_personas",
          message: personasError.message,
          details: personasError,
        } as ApiError,
      },
      { status: 500 }
    );
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
    return NextResponse.json(
      {
        error: {
          step: "upsert_keywords",
          message: keywordsError.message,
          details: keywordsError,
        },
      },
      { status: 500 }
    );
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
    return NextResponse.json(
      {
        error: {
          step: "upsert_company_keywords",
          message: companyKeywordsError.message,
          details: companyKeywordsError,
        },
      },
      { status: 500 }
    );
  }


  return NextResponse.json({
    success: true,
    message: "Slideforge sample data seeded",
    company_id: companyId,
  });
}
