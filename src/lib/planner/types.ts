export type Company = {
  id: string;
  name: string;
  website?: string | null;
  description: string;
  posts_per_week: number;
};

export type Persona = {
  id: string;
  company_id: string;
  username: string;
  bio: string;
};

export type Subreddit = {
  id: string;
  company_id: string;
  name: string; // e.g. "r/PowerPoint"
};

export type Keyword = {
  id: string;      // e.g. "K1"
  phrase: string;  // e.g. "best ai presentation maker"
};

export type GeneratedPost = {
  subreddit: string;
  title: string;
  body: string;
  author_username: string;
  scheduled_at: string; // ISO
  keyword_ids: string[]; // ["K1","K4"]
};

export type GeneratedComment = {
  post_temp_index: number; // index of post in generated array
  parent_temp_index: number | null; // index of parent comment in generated list for that post
  comment_text: string;
  username: string;
  scheduled_at: string; // ISO
};

export type GenerationResult = {
  posts: GeneratedPost[];
  comments: GeneratedComment[];
  quality: {
    score: number; // 0-10
    flags: Record<string, boolean>;
    notes: string;
  };
};
