// level-test.js: the question bank's integrity, the 20-question draw and
// the scoring that turns answers into A1-C2.
//
// Run: node --test tests/

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadScripts } = require("./helpers/load-scripts");

const ctx = loadScripts(["level-test.js"]);
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

test("bank: 8 questions per level, unique ids, 4 distinct options each", () => {
  const bank = ctx.armusLevelTestBank();
  assert.equal(bank.length, 48);
  LEVELS.forEach(level => assert.equal(bank.filter(q => q.level === level).length, 8, level));
  assert.equal(new Set(bank.map(q => q.id)).size, bank.length);
  bank.forEach(q => {
    assert.equal(q.options.length, 4, q.id);
    assert.equal(new Set(q.options).size, 4, q.id);
    assert.ok(["grammar", "vocabulary", "reading"].includes(q.skill), q.id);
    if (q.skill === "reading") assert.ok(q.passage && q.passage.length > 40, q.id);
    else assert.ok(/___|\*[a-z]+\*/.test(q.prompt), `${q.id} has a blank or a marked word`);
  });
});

test("bank: every level has grammar, vocabulary and a reading text", () => {
  const bank = ctx.armusLevelTestBank();
  LEVELS.forEach(level => {
    const skills = new Set(bank.filter(q => q.level === level).map(q => q.skill));
    assert.deepEqual([...skills].sort(), ["grammar", "reading", "vocabulary"], level);
  });
});

test("draw: 20 questions, easiest level first, per-level counts as planned", () => {
  for (let seed = 1; seed <= 25; seed++) {
    const qs = ctx.armusDrawLevelTest(seeded(seed));
    assert.equal(qs.length, 20);
    const order = qs.map(q => LEVELS.indexOf(q.level));
    assert.deepEqual(order, order.slice().sort((a, b) => a - b), `seed ${seed}: levels in order`);
    LEVELS.forEach(level => assert.equal(qs.filter(q => q.level === level).length, PLAN[level], `seed ${seed} ${level}`));
    assert.equal(new Set(qs.map(q => q.id)).size, 20, `seed ${seed}: no repeats`);
  }
});

test("draw: each level mixes all three skills, and the right answer is among the shuffled options", () => {
  for (let seed = 1; seed <= 25; seed++) {
    const qs = ctx.armusDrawLevelTest(seeded(seed));
    LEVELS.forEach(level => {
      const skills = new Set(qs.filter(q => q.level === level).map(q => q.skill));
      assert.equal(skills.size, 3, `seed ${seed} ${level}`);
    });
    qs.forEach(q => {
      const original = ctx.armusLevelTestBank().find(b => b.id === q.id);
      assert.equal(q.correct, original.options[0]);
      assert.deepEqual(q.options.slice().sort(), original.options.slice().sort());
    });
  }
});

test("draw: the bank itself is never reordered", () => {
  const before = JSON.stringify(ctx.armusLevelTestBank());
  ctx.armusDrawLevelTest(seeded(7));
  assert.equal(JSON.stringify(ctx.armusLevelTestBank()), before);
});

test("score: everything right -> C2, nothing right -> A1", () => {
  const qs = ctx.armusDrawLevelTest(seeded(3));
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
  const qs = ctx.armusDrawLevelTest(seeded(11));
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
  const qs = ctx.armusDrawLevelTest(seeded(5));
  const wrong = qs.map(q => q.options.find(o => o !== q.correct));
  const r = ctx.armusScoreLevelTest(qs, wrong);
  assert.equal(r.level, "A1");
  assert.equal(r.correct, 0);
  assert.equal(r.skipped, 0);
});

test("score: scattered right answers (a third here, a quarter there) stay at A1", () => {
  const qs = ctx.armusDrawLevelTest(seeded(9));
  const shares = { A1: 1 / 3, A2: 1 / 3, B1: 0.25, B2: 0.25, C1: 1 / 3, C2: 1 / 3 };
  assert.equal(ctx.armusScoreLevelTest(qs, answersFor(qs, shares)).level, "A1");
});

test("score: a lucky high level doesn't lift a weak base", () => {
  const qs = ctx.armusDrawLevelTest(seeded(13));
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
