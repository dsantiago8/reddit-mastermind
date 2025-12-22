import { Company, Persona, Subreddit, Keyword, GenerationResult } from "./types";
import {
  addDays,
  addMinutes,
  clamp,
  iso,
  looksManufactured,
  mulberry32,
  pickOne,
  shuffle,
  weightedSampleUnique,
} from "./utils";

type Inputs = {
  company: Company;
  personas: Persona[];
  subreddits: Subreddit[];
  keywords: Keyword[];
  // optional: ids used recently to avoid repetition
  recentKeywordIds?: string[];
  recentSubreddits?: string[];
  seed?: number;
  weekStart: Date; // start-of-week in UTC
};

function buildPostTitle(keyword: Keyword, subreddit: string, companyName: string, rng: () => number) {
  const k = keyword.phrase;
  const templates = [
    `What’s the best ${k}?`,
    `Any good ${k} recommendations?`,
    `Struggling with ${k} — what do you all use?`,
    `Best workflow for ${k}?`,
    `${companyName} vs alternatives for ${k}?`,
  ];

  // subreddit flavor
  if (subreddit.toLowerCase().includes("powerpoint")) {
    templates.push(`PowerPoint people: best ${k}?`);
    templates.push(`How are you doing ${k} in PowerPoint?`);
  }
  if (subreddit.toLowerCase().includes("canva")) {
    templates.push(`Canva users: what’s your pick for ${k}?`);
  }
  if (subreddit.toLowerCase().includes("claude")) {
    templates.push(`Claude for ${k} — worth it?`);
  }

  return pickOne(rng, templates);
}

function buildPostBody(company: Company, persona: Persona, keyword: Keyword, rng: () => number) {
  const painPoints = [
    "I keep losing time on formatting.",
    "My slides always end up looking generic.",
    "I’m fine with the outline, but the actual deck takes forever.",
    "I’m trying to keep the narrative tight and not overload each slide.",
    "I’m not a designer and it shows.",
  ];

  const constraints = [
    "Need something I can use weekly without babysitting.",
    "Mostly for internal reviews + occasional customer decks.",
    "Would love a workflow that starts from bullet points.",
    "Needs to be fast — I’m usually doing this under deadline.",
    "Ideally something that doesn’t fight the brand style.",
  ];

  const prompts = [
    "What’s your current stack for this?",
    "Any tools that actually help beyond templates?",
    "How do you avoid spending hours nudging text boxes?",
    "What do you use when you need a deck that looks 'done'?",
    "Any recs that feel less clunky than my current process?",
  ];

  const line1 = `Context: ${persona.bio}`;
  const line2 = `I’m looking into ${keyword.phrase}. ${pickOne(rng, painPoints)}`;
  const line3 = `${pickOne(rng, constraints)} ${pickOne(rng, prompts)}`;

  // Light mention of company without sounding like an ad:
  const softMentions = [
    `I saw ${company.name} mentioned in a thread but haven’t tried it yet.`,
    `Someone suggested ${company.name}—curious if it’s legit or just hype.`,
    `Has anyone tested ${company.name} vs other options?`,
  ];

  const includeSoftMention = rng() < 0.45;
  const mention = includeSoftMention ? `\n\n${pickOne(rng, softMentions)}` : "";

  return `${line1}\n\n${line2}\n\n${line3}${mention}`;
}

function buildComment(persona: Persona, keyword: Keyword, company: Company, rng: () => number, role: "support" | "neutral" | "counter") {
  const support = [
    `I’ve tried a bunch of tools. ${company.name} is the only one that reliably turns rough notes into something presentable.`,
    `+1 on ${company.name}. It saves me from the “align everything manually” spiral.`,
    `If your bottleneck is going from outline → clean deck, ${company.name} is honestly solid.`,
  ];

  const neutral = [
    `Depends on your workflow. If you already have structure, an outline-first tool helps a lot.`,
    `For ${keyword.phrase}, I’d focus on reducing manual layout work. That’s usually the time sink.`,
    `If you’re on a deadline, pick something that gives you a decent first draft you can polish.`,
  ];

  const counter = [
    `I tried a few AI deck tools and some feel gimmicky. Make sure you can export cleanly.`,
    `One caution: some tools lock you into weird templates. Check how editable the output is.`,
    `If your decks need strict brand rules, you might still end up doing manual cleanup.`,
  ];

  const pick = role === "support" ? support : role === "neutral" ? neutral : counter;
  // Keep it persona-ish:
  return `${persona.username}: ${pickOne(rng, pick)}`;
}

export function generateWeekPlan(inputs: Inputs): GenerationResult {
  const { company, personas, subreddits, keywords, weekStart } = inputs;

  const seed =
    inputs.seed ??
    // stable-ish seed based on week + company
    Math.abs(
      (company.id + iso(weekStart))
        .split("")
        .reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
    );

  const rng = mulberry32(seed);

  const postsPerWeek = clamp(company.posts_per_week ?? 3, 1, 14);

  // --- 1) Choose which subreddits + keywords to use this week ---
  const recentKeywordSet = new Set(inputs.recentKeywordIds ?? []);
  const recentSubredditSet = new Set((inputs.recentSubreddits ?? []).map((s) => s.toLowerCase()));

  const keywordPicks = weightedSampleUnique(
    rng,
    keywords.map((k) => ({ ...k, id: k.id })),
    (k) => (recentKeywordSet.has(k.id) ? 0.15 : 1.0),
    postsPerWeek
  );

  const subredditPicks = weightedSampleUnique(
    rng,
    subreddits.map((s) => ({ ...s, id: s.id })),
    (s) => (recentSubredditSet.has(s.name.toLowerCase()) ? 0.35 : 1.0),
    postsPerWeek
  );

  // --- 2) Assign personas (avoid same persona posting everything) ---
  const personaPool = shuffle(rng, personas);
  const postAuthors: Persona[] = [];
  for (let i = 0; i < postsPerWeek; i++) {
    // rotate with mild randomness
    postAuthors.push(personaPool[i % personaPool.length]);
  }

  // --- 3) Schedule posts throughout the week (avoid clustering) ---
  // pick days Mon-Sat mostly, few on Sun
  const dayWeights = [1.1, 1.2, 1.15, 1.2, 1.1, 0.9, 0.6];
  const dayBuckets: number[] = [];
  for (let i = 0; i < postsPerWeek; i++) {
    const total = dayWeights.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    let day = 0;
    for (; day < dayWeights.length; day++) {
      r -= dayWeights[day];
      if (r <= 0) break;
    }
    dayBuckets.push(clamp(day, 0, 6));
  }
  dayBuckets.sort((a, b) => a - b);

  const posts = Array.from({ length: postsPerWeek }).map((_, idx) => {
    const keyword = keywordPicks[idx % keywordPicks.length];
    const subreddit = subredditPicks[idx % subredditPicks.length];
    const author = postAuthors[idx];

    // schedule time: random between 16:00–23:00 UTC (roughly daytime US)
    const base = addDays(weekStart, dayBuckets[idx]);
    const minuteOfDay = Math.floor((16 * 60 + rng() * (7 * 60)) / 5) * 5; // 5-min increments
    const scheduled = addMinutes(base, minuteOfDay);

    // attach 1-3 keyword ids (primary + 0-2 neighbors)
    const extras = shuffle(rng, keywords)
      .filter((k) => k.id !== keyword.id)
      .slice(0, rng() < 0.6 ? 1 : 2)
      .map((k) => k.id);

    const keyword_ids = [keyword.id, ...extras].slice(0, 3);

    return {
      subreddit: subreddit.name,
      title: buildPostTitle(keyword, subreddit.name, company.name, rng),
      body: buildPostBody(company, author, keyword, rng),
      author_username: author.username,
      scheduled_at: iso(scheduled),
      keyword_ids,
    };
  });

  // --- 4) Generate comment threads (2–4 comments each) ---
  const comments = [];
  for (let p = 0; p < posts.length; p++) {
    const post = posts[p];

    const nComments = rng() < 0.25 ? 2 : rng() < 0.75 ? 3 : 4;

    // pick commenters (exclude post author to avoid instant self-replies)
    const commenters = shuffle(
      rng,
      personas.filter((x) => x.username !== post.author_username)
    );

    // thread timing: start 25–120 mins after post, then 6–45 mins between
    let t = new Date(post.scheduled_at);
    t = addMinutes(t, 25 + Math.floor(rng() * 95));

    // comment #1: neutral or mild counter (sounds real)
    const c1Author = commenters[0] ?? personas[0];
    const keywordId = post.keyword_ids[0];
    const kw = keywords.find((k) => k.id === keywordId) ?? keywords[0];

    const c1Text = buildComment(c1Author, kw, company, rng, rng() < 0.7 ? "neutral" : "counter");
    const c1Index: number = comments.length;
    comments.push({
      post_temp_index: p,
      parent_temp_index: null,
      comment_text: c1Text.replace(`${c1Author.username}: `, ""),
      username: c1Author.username,
      scheduled_at: iso(t),
    });

    // optional reply by OP (feels natural)
    if (rng() < 0.65) {
      t = addMinutes(t, 6 + Math.floor(rng() * 25));
      comments.push({
        post_temp_index: p,
        parent_temp_index: c1Index,
        comment_text: `Appreciate it — that’s helpful. Any specific tools you’d recommend?`,
        username: post.author_username,
        scheduled_at: iso(t),
      });
    }

    // one “support” mention by another persona later (subtle)
    const supportAuthor = commenters[1] ?? commenters[0] ?? personas[0];
    t = addMinutes(t, 10 + Math.floor(rng() * 35));
    comments.push({
      post_temp_index: p,
      parent_temp_index: c1Index,
      comment_text: buildComment(supportAuthor, kw, company, rng, "support").replace(
        `${supportAuthor.username}: `,
        ""
      ),
      username: supportAuthor.username,
      scheduled_at: iso(t),
    });

    // optional extra comment adds nuance (avoid all praise)
    if (nComments >= 4) {
      const extraAuthor = commenters[2] ?? supportAuthor;
      t = addMinutes(t, 8 + Math.floor(rng() * 40));
      comments.push({
        post_temp_index: p,
        parent_temp_index: null,
        comment_text: buildComment(extraAuthor, kw, company, rng, rng() < 0.5 ? "neutral" : "counter").replace(
          `${extraAuthor.username}: `,
          ""
        ),
        username: extraAuthor.username,
        scheduled_at: iso(t),
      });
    }
  }

  // --- 5) Quality scoring ---
  // Flags: same persona dominates, too many support comments, salesy language
  const flags: Record<string, boolean> = {};
  const authorCounts = new Map<string, number>();
  for (const p of posts) authorCounts.set(p.author_username, (authorCounts.get(p.author_username) ?? 0) + 1);

  const maxShare = Math.max(...Array.from(authorCounts.values())) / posts.length;
  flags["single_persona_dominates"] = maxShare > 0.6;

  const salesy = [...posts.map((p) => p.body), ...comments.map((c) => c.comment_text)].some(looksManufactured);
  flags["salesy_language"] = salesy;

  // if OP replies too often immediately
  const opReplyCount = comments.filter((c) => c.username === posts[c.post_temp_index].author_username).length;
  flags["too_many_op_replies"] = opReplyCount / Math.max(1, posts.length) > 1.2;

  // Score starts at 9 and subtract penalties
  let score = 9;
  if (flags["single_persona_dominates"]) score -= 2;
  if (flags["salesy_language"]) score -= 3;
  if (flags["too_many_op_replies"]) score -= 1;
  score = clamp(score, 0, 10);

  const notes = [
    flags["single_persona_dominates"] ? "Rotate posting personas more." : "Persona rotation looks good.",
    flags["salesy_language"] ? "Language feels promotional; soften mentions and reduce CTAs." : "Tone looks natural.",
    flags["too_many_op_replies"] ? "OP replies are a bit frequent; let others talk more." : "Conversation pacing is reasonable.",
  ].join(" ");

  return {
    posts,
    comments,
    quality: { score, flags, notes },
  };
}
