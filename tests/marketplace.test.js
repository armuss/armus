// Regression test for marketplace.js's armusEnrichDemoTeacherReviews -
// demo teachers (teachers-data.js) have a fixed, hand-written rating/
// reviewCount for marketing purposes, but real students can book and
// review them too. This guards that a real review actually moves the
// displayed rating/reviewCount instead of leaving them frozen forever
// at the original decorative numbers, regardless of real outcomes.
//
// Run: node --test tests/

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadScripts } = require("./helpers/load-scripts");

const ctx = loadScripts(["marketplace.js", "reviews.js"]);

function demoTeacher() {
  return {
    id: "sarah",
    name: "Sarah M.",
    rating: 4.9,
    reviewCount: 127,
    reviews: [
      { name: "Mehmet K.", stars: 5, text: "..." },
      { name: "Elif A.", stars: 5, text: "..." },
    ],
  };
}

test("armusEnrichDemoTeacherReviews - no real reviews yet: rating/reviewCount stay exactly as hand-written", async () => {
  ctx.armusGetReviewsForTeacher = async () => [];
  const enriched = await ctx.armusEnrichDemoTeacherReviews(demoTeacher());
  assert.equal(enriched.rating, 4.9);
  assert.equal(enriched.reviewCount, 127);
  assert.equal(enriched.reviews.length, 2);
});

test("armusEnrichDemoTeacherReviews - a real review increases reviewCount and blends into rating", async () => {
  ctx.armusGetReviewsForTeacher = async () => [
    { studentName: "Ayşe Y.", stars: 3, text: "fena değildi", createdAt: "2026-01-01T00:00:00Z" },
  ];
  const teacher = demoTeacher();
  const enriched = await ctx.armusEnrichDemoTeacherReviews(teacher);

  // reviewCount grows by exactly the number of real reviews added
  assert.equal(enriched.reviewCount, 128);

  // rating is a weighted average of the hand-written baseline (4.9 over
  // 127 reviews) and the one real 3-star review - a single review
  // against a baseline that large only nudges it slightly (and this one
  // happens to still round to 4.9), but it's now a real computed value
  // instead of the untouched hand-written constant.
  const expectedRating = Math.round(((4.9 * 127 + 3) / 128) * 10) / 10;
  assert.equal(enriched.rating, expectedRating);

  // the real review is merged on top of the hand-written ones, not
  // replacing them
  assert.equal(enriched.reviews.length, 3);
  assert.equal(enriched.reviews[0].stars, 3);
});

test("armusEnrichDemoTeacherReviews - several consistently low real reviews pull the rating down further", async () => {
  ctx.armusGetReviewsForTeacher = async () => [
    { studentName: "A", stars: 1, text: "", createdAt: "2026-01-01T00:00:00Z" },
    { studentName: "B", stars: 1, text: "", createdAt: "2026-01-02T00:00:00Z" },
    { studentName: "C", stars: 1, text: "", createdAt: "2026-01-03T00:00:00Z" },
  ];
  const enriched = await ctx.armusEnrichDemoTeacherReviews(demoTeacher());
  assert.equal(enriched.reviewCount, 130);
  const expectedRating = Math.round(((4.9 * 127 + 1 + 1 + 1) / 130) * 10) / 10;
  assert.equal(enriched.rating, expectedRating);
});

// armusGetRegisteredTeachers (the marketplace grid) used to download the
// ENTIRE site-wide reviews table (masked_reviews.select("*")) just to
// compute a per-teacher rating/count the grid cards actually show -
// replaced with the teacher_review_stats() RPC (migration_91.sql),
// which aggregates server-side instead. This guards that the RPC's
// result is correctly mapped onto each teacher's rating/reviewCount,
// including a teacher with zero reviews (absent from the RPC's rows
// entirely, since it's a group-by).
test("armusGetRegisteredTeachers - maps teacher_review_stats onto each teacher's rating/reviewCount", async () => {
  ctx.armusT = (key, fallback) => fallback;
  ctx.armusIsTeacherOnline = () => false;
  ctx.armusSupabase = {
    from(table) {
      assert.equal(table, "masked_profiles", "should query masked_profiles, not the raw profiles table");
      return {
        select() { return this; },
        eq() { return this; },
        then(resolve) {
          resolve({
            data: [
              { id: "t1", name: "Teacher One", price: 500 },
              { id: "t2", name: "Teacher Two", price: 600 },
              { id: "t3", name: "No Reviews Yet", price: 700 },
            ],
            error: null,
          });
        },
      };
    },
    rpc(name) {
      if (name === "teacher_review_stats") {
        return Promise.resolve({
          data: [
            { teacher_id: "t1", avg_rating: 4.7, review_count: 3 },
            { teacher_id: "t2", avg_rating: 3.0, review_count: 1 },
            // t3 intentionally absent - a teacher with zero reviews
            // never appears in a group-by aggregate
          ],
          error: null,
        });
      }
      if (name === "teacher_marketplace_stats") {
        return Promise.resolve({ data: [], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    },
  };

  const teachers = await ctx.armusGetRegisteredTeachers();
  const byId = Object.fromEntries(teachers.map(t => [t.id, t]));

  assert.equal(byId.t1.rating, 4.7);
  assert.equal(byId.t1.reviewCount, 3);
  assert.equal(byId.t2.rating, 3.0);
  assert.equal(byId.t2.reviewCount, 1);
  assert.equal(byId.t3.rating, null, "a teacher with no reviews gets null rating, not 0 or NaN");
  assert.equal(byId.t3.reviewCount, 0);

  // the per-teacher review array itself stays empty on this path - the
  // grid never shows individual review text, so none was ever fetched
  assert.equal(byId.t1.reviews.length, 0);
});
