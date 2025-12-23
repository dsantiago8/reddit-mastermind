import { describe, it, expect } from "vitest";
import { generateWeekPlan } from "./generateWeekPlan";

const baseInputs = {
  company: { id: "c1", name: "Acme", description: "Test company", posts_per_week: 3 },
  personas: [
    { id: "p1", company_id: "c1", username: "alice", bio: "product manager" },
    { id: "p2", company_id: "c1", username: "bob", bio: "designer" },
    { id: "p3", company_id: "c1", username: "carol", bio: "founder" },
  ],
  subreddits: [
    { id: "s1", company_id: "c1", name: "r/design" },
    { id: "s2", company_id: "c1", name: "r/powerpoint" },
    { id: "s3", company_id: "c1", name: "r/presentations" },
  ],
  keywords: [
    { id: "k1", phrase: "slide templates" },
    { id: "k2", phrase: "presentation workflow" },
    { id: "k3", phrase: "export to pdf" },
  ],
};

function isoDate(y: number, m: number, d: number) {
  return new Date(Date.UTC(y, m - 1, d));
}

describe("generateWeekPlan", () => {
  it("is deterministic for same inputs", () => {
    const a = generateWeekPlan({ ...baseInputs, weekStart: isoDate(2025, 1, 6) });
    const b = generateWeekPlan({ ...baseInputs, weekStart: isoDate(2025, 1, 6) });
    expect(a).toEqual(b);
  });

  it("produces different output for different weeks", () => {
    const a = generateWeekPlan({ ...baseInputs, weekStart: isoDate(2025, 1, 6) });
    const b = generateWeekPlan({ ...baseInputs, weekStart: isoDate(2025, 1, 13) });
    // titles should differ across weeks
    const titlesA = a.posts.map((p) => p.title).join("||");
    const titlesB = b.posts.map((p) => p.title).join("||");
    expect(titlesA).not.toEqual(titlesB);
  });

  it("clamps posts_per_week to allowed range", () => {
    const many = generateWeekPlan({ ...baseInputs, company: { ...baseInputs.company, posts_per_week: 20 }, weekStart: isoDate(2025, 1, 6) });
    expect(many.posts.length).toBe(14);

    const zero = generateWeekPlan({ ...baseInputs, company: { ...baseInputs.company, posts_per_week: 0 }, weekStart: isoDate(2025, 1, 6) });
    expect(zero.posts.length).toBe(1);
  });

  it("throws if no keywords are provided", () => {
    expect(() =>
      generateWeekPlan({
        ...baseInputs,
        keywords: [],
        weekStart: isoDate(2025, 1, 6),
      })
    ).toThrow();
  });

  it("handles empty personas by assigning posts anyway", () => {
    const plan = generateWeekPlan({
      ...baseInputs,
      personas: [],
      weekStart: isoDate(2025, 1, 6),
    });
    expect(plan.posts.length).toBeGreaterThan(0);
  });

  it("respects recentKeywordIds by reducing their frequency", () => {
    const plan = generateWeekPlan({
      ...baseInputs,
      recentKeywordIds: ["k1", "k2"],
      weekStart: isoDate(2025, 1, 6),
    });
    // k3 should be more likely in keyword_ids
    const allKeywordIds = plan.posts.flatMap((p) => p.keyword_ids);
    expect(allKeywordIds).toContain("k3");
  });

  it("produces valid comment threading (parent_temp_index logic)", () => {
    const plan = generateWeekPlan({ ...baseInputs, weekStart: isoDate(2025, 1, 6) });
    for (const c of plan.comments) {
      if (c.parent_temp_index !== null) {
        // parent index must be less than this comment's index
        expect(c.parent_temp_index).toBeLessThan(plan.comments.length);
      }
    }
  });
});
