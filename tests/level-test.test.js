// level-test.js and level-test-bank/: the six goal pools' integrity, the
// 20-question draw and the scoring that turns answers into A1-C2.
//
// Run: node --test tests/

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadScripts } = require("./helpers/load-scripts");

const ctx = loadScripts([
  "level-test.js",
  "level-test-bank/yds.js",
  "level-test-bank/ielts.js",
  "level-test-bank/work.js",
  "level-test-bank/speaking.js",
  "level-test-bank/travel.js",
  "level-test-bank/school.js",
]);
const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const PLAN = { A1: 3, A2: 3, B1: 4, B2: 4, C1: 3, C2: 3 };

// a fixed-seed random so a failing draw can be reproduced
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// answer every question of the given levels right (or a share of each,
// by position within the level), skip the rest
function answersFor(questions, rightShareByLevel) {
  const seen = {};
  return questions.map(q => {
    seen[q.level] = (seen[q.level] || 0) + 1;
    const share = rightShareByLevel[q.level] || 0;
    const rightCount = Math.round(share * PLAN[q.level]);
    return seen[q.level] <= rightCount ? q.correct : null;
  });
}

const GOALS = ["yds", "ielts", "work", "speaking", "travel", "school"];
const POOL = { A1: 16, A2: 16, B1: 18, B2: 18, C1: 16, C2: 16 };

test("pools: one per goal, 100 questions each, graded A1-C2 as planned", () => {
  GOALS.forEach(goal => {
    const bank = ctx.armusLevelTestBank(goal);
    assert.equal(bank.length, 100, goal);
    LEVELS.forEach(level => assert.equal(bank.filter(q => q.level === level).length, POOL[level], `${goal} ${level}`));
    bank.forEach(q => assert.equal(q.goal, goal, q.id));
  });
});

test("pools: unique ids and prompts, 4 distinct options, a blank or a text for each", () => {
  const all = ctx.armusLevelTestBank();
  assert.equal(all.length, 600);
  assert.equal(new Set(all.map(q => q.id)).size, all.length);
  GOALS.forEach(goal => {
    const bank = ctx.armusLevelTestBank(goal);
    const keys = bank.map(q => (q.passage || "") + q.prompt);
    assert.equal(new Set(keys).size, bank.length, `${goal}: a question appears twice`);
  });
  all.forEach(q => {
    assert.equal(q.options.length, 4, q.id);
    assert.equal(new Set(q.options).size, 4, q.id);
    q.options.forEach(o => assert.ok(typeof o === "string" && o.trim() === o && o.length > 0, `${q.id}: option "${o}"`));
    assert.ok(["grammar", "vocabulary", "reading"].includes(q.skill), q.id);
    if (q.skill === "reading") {
      assert.ok(q.passage && q.passage.length > 40, q.id);
      assert.ok(!/___/.test(q.prompt), `${q.id}: a reading question asks about the text`);
    } else {
      assert.ok(!q.passage, q.id);
      assert.ok(/___|\*[a-z]+\*/.test(q.prompt), `${q.id} has a blank or a marked word`);
    }
  });
});

test("pools: every level of every goal has grammar, vocabulary and at least 3 texts", () => {
  GOALS.forEach(goal => {
    const bank = ctx.armusLevelTestBank(goal);
    LEVELS.forEach(level => {
      const here = bank.filter(q => q.level === level);
      const skills = new Set(here.map(q => q.skill));
      assert.deepEqual([...skills].sort(), ["grammar", "reading", "vocabulary"], `${goal} ${level}`);
      assert.ok(here.filter(q => q.skill === "reading").length >= 3, `${goal} ${level}`);
    });
  });
});

test("draw: 20 questions from the chosen goal, easiest level first, per-level counts as planned", () => {
  GOALS.forEach(goal => {
    for (let seed = 1; seed <= 15; seed++) {
      const qs = ctx.armusDrawLevelTest({ goal, rnd: seeded(seed) });
      assert.equal(qs.length, 20);
      qs.forEach(q => assert.equal(q.goal, goal, `${goal} seed ${seed}: ${q.id}`));
      const order = qs.map(q => LEVELS.indexOf(q.level));
      assert.deepEqual(order, order.slice().sort((a, b) => a - b), `${goal} seed ${seed}: levels in order`);
      LEVELS.forEach(level => assert.equal(qs.filter(q => q.level === level).length, PLAN[level], `${goal} seed ${seed} ${level}`));
      assert.equal(new Set(qs.map(q => q.id)).size, 20, `${goal} seed ${seed}: no repeats`);
    }
  });
});

test("draw: no goal mixes the pools; an unknown goal falls back to the mix", () => {
  const goalsSeen = new Set();
  for (let seed = 1; seed <= 10; seed++) {
    ctx.armusDrawLevelTest({ rnd: seeded(seed) }).forEach(q => goalsSeen.add(q.goal));
  }
  assert.ok(goalsSeen.size >= 4, `mixed draw used ${goalsSeen.size} pools`);
  assert.equal(ctx.armusDrawLevelTest({ goal: "nope", rnd: seeded(2) }).length, 20);
});

test("draw: each level mixes all three skills, and the right answer is among the shuffled options", () => {
  GOALS.forEach(goal => {
    for (let seed = 1; seed <= 10; seed++) {
      const qs = ctx.armusDrawLevelTest({ goal, rnd: seeded(seed) });
      LEVELS.forEach(level => {
        const skills = new Set(qs.filter(q => q.level === level).map(q => q.skill));
        assert.equal(skills.size, 3, `${goal} seed ${seed} ${level}`);
      });
      qs.forEach(q => {
        const original = ctx.armusLevelTestBank(goal).find(b => b.id === q.id);
        assert.equal(q.correct, original.options[0]);
        assert.deepEqual(q.options.slice().sort(), original.options.slice().sort());
      });
    }
  });
});

test("draw: two people starting together get different questions, both starting easy", () => {
  GOALS.forEach(goal => {
    const firsts = new Set();
    let sameTests = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const a = ctx.armusDrawLevelTest({ goal, rnd: seeded(seed) });
      const b = ctx.armusDrawLevelTest({ goal, rnd: seeded(seed + 1000) });
      assert.equal(a[0].level, "A1");
      firsts.add(a[0].id);
      if (a.map(q => q.id).join() === b.map(q => q.id).join()) sameTests++;
    }
    assert.ok(firsts.size >= 8, `${goal}: only ${firsts.size} different first questions`);
    assert.equal(sameTests, 0, goal);
  });
});

test("draw: a retake asks questions this browser hasn't seen first", () => {
  GOALS.forEach(goal => {
    for (let seed = 1; seed <= 30; seed++) {
      const first = ctx.armusDrawLevelTest({ goal, rnd: seeded(seed) });
      const second = ctx.armusDrawLevelTest({ goal, rnd: seeded(seed + 500), seen: first.map(q => q.id) });
      const overlap = second.filter(q => first.some(f => f.id === q.id));
      assert.equal(overlap.length, 0, `${goal} seed ${seed}: ${overlap.map(q => q.id).join(", ")}`);
      // and the retake still mixes the three skills on every level
      LEVELS.forEach(level => assert.equal(new Set(second.filter(q => q.level === level).map(q => q.skill)).size, 3, `${goal} seed ${seed} ${level}`));
    }
    // once every question has been seen, the draw still fills the test
    const everything = ctx.armusLevelTestBank(goal).map(q => q.id);
    assert.equal(ctx.armusDrawLevelTest({ goal, rnd: seeded(23), seen: everything }).length, 20);
  });
});

test("draw: the pools themselves are never reordered", () => {
  const before = JSON.stringify(ctx.armusLevelTestBank());
  ctx.armusDrawLevelTest({ goal: "work", rnd: seeded(7) });
  ctx.armusDrawLevelTest({ rnd: seeded(8) });
  assert.equal(JSON.stringify(ctx.armusLevelTestBank()), before);
});

test("score: everything right -> C2, nothing right -> A1", () => {
  const qs = ctx.armusDrawLevelTest({ goal: "yds", rnd: seeded(3) });
  const all = ctx.armusScoreLevelTest(qs, qs.map(q => q.correct));
  assert.equal(all.level, "C2");
  assert.equal(all.next, null);
  assert.equal(all.correct, 20);
  assert.deepEqual({ ...all.skills }, { grammar: 100, vocabulary: 100, reading: 100 });
  const none = ctx.armusScoreLevelTest(qs, qs.map(() => null));
  assert.equal(none.level, "A1");
  assert.equal(none.next, "A2");
  assert.equal(none.skipped, 20);
});

test("score: the level follows how far up the answers hold", () => {
  const qs = ctx.armusDrawLevelTest({ goal: "yds", rnd: seeded(11) });
  const cases = [
    [{ A1: 1, A2: 1, B1: 1, B2: 0.5 }, "B1"],
    [{ A1: 1, A2: 1, B1: 1, B2: 0.75 }, "B2"],
    [{ A1: 1, A2: 1, B1: 1, B2: 1 }, "B2"],
    [{ A1: 1, A2: 1, B1: 1, B2: 1, C1: 2 / 3 }, "C1"],
    [{ A1: 1, A2: 2 / 3 }, "A2"],
    [{ A1: 1, A2: 1 / 3 }, "A1"],
    [{ A1: 1, A2: 1, B1: 0.75 }, "B1"],
  ];
  cases.forEach(([shares, expected]) => {
    assert.equal(ctx.armusScoreLevelTest(qs, answersFor(qs, shares)).level, expected, JSON.stringify(shares));
  });
});

test("score: a wrong option counts like a skip for the level, but not as skipped", () => {
  const qs = ctx.armusDrawLevelTest({ goal: "yds", rnd: seeded(5) });
  const wrong = qs.map(q => q.options.find(o => o !== q.correct));
  const r = ctx.armusScoreLevelTest(qs, wrong);
  assert.equal(r.level, "A1");
  assert.equal(r.correct, 0);
  assert.equal(r.skipped, 0);
});

test("score: scattered right answers (a third here, a quarter there) stay at A1", () => {
  const qs = ctx.armusDrawLevelTest({ goal: "yds", rnd: seeded(9) });
  const shares = { A1: 1 / 3, A2: 1 / 3, B1: 0.25, B2: 0.25, C1: 1 / 3, C2: 1 / 3 };
  assert.equal(ctx.armusScoreLevelTest(qs, answersFor(qs, shares)).level, "A1");
});

test("score: a lucky high level doesn't lift a weak base", () => {
  const qs = ctx.armusDrawLevelTest({ goal: "yds", rnd: seeded(13) });
  // A1 2/3, A2 1/3, B1 2/4, B2 and C1 nothing, C2 all right: C2's own 3/3
  // passes, but only 8 of the 20 so far are right (40%), so it doesn't count
  const r = ctx.armusScoreLevelTest(qs, answersFor(qs, { A1: 2 / 3, A2: 1 / 3, B1: 0.5, C2: 1 }));
  assert.equal(r.level, "A1");
});

test("weakest skill: lowest score, grammar first on a tie", () => {
  assert.equal(ctx.armusLevelTestWeakestSkill({ grammar: 70, vocabulary: 55, reading: 65 }), "vocabulary");
  assert.equal(ctx.armusLevelTestWeakestSkill({ grammar: 50, vocabulary: 50, reading: 80 }), "grammar");
  assert.equal(ctx.armusLevelTestWeakestSkill({ grammar: 90, vocabulary: 80, reading: 40 }), "reading");
});
