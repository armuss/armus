/*
 * ARMUS - the free level test (seviye-testi.html): the draw and the
 * scoring. No DOM here - the page does the screens, this file only decides
 * what to ask and what the answers mean, so tests/level-test.test.js can
 * check it directly.
 *
 * Questions: one pool per goal (YDS / YÖKDİL, IELTS / TOEFL, work,
 * speaking, travel, school), 100 questions each, written for that goal and
 * graded A1-C2 (16 A1, 16 A2, 18 B1, 18 B2, 16 C1, 16 C2). Each pool lives
 * in its own file in level-test-bank/ and registers itself here with
 * armusAddLevelTestBank. Someone who skips the goal gets all six pools
 * mixed.
 *
 * A test is 20 questions from easy to hard: 3 A1, 3 A2, 4 B1, 4 B2, 3 C1,
 * 3 C2, drawn at random for every sitting, so two people starting at the
 * same moment get different questions (but both start easy). Within a
 * level the skills are mixed (grammar, vocabulary, reading), and questions
 * this browser has already seen go to the back of the queue, so a retake
 * is a new test until the pool runs out. In a pool, the first option is
 * always the right answer; the draw shuffles them.
 *
 * Scoring: a skip or a timeout counts as wrong (which is why the page
 * offers "Bilmiyorum" - it keeps lucky guesses out). A level is reached
 * when at least 60% of its own questions are right AND at least 60% of
 * all the questions up to it; the result is the highest level reached
 * (A1 if none). So A1-B1 right plus half of B2 is B1, three of four B2
 * questions too is B2, and scattered guessing stays at A1. It's a quick
 * self-check, not a certificate - the page says the first lesson's
 * teacher confirms the level.
 */

const ARMUS_LEVEL_TEST_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const ARMUS_LEVEL_TEST_PLAN = { A1: 3, A2: 3, B1: 4, B2: 4, C1: 3, C2: 3 };
const ARMUS_LEVEL_TEST_SECONDS = 60;
const ARMUS_LEVEL_TEST_PASS = 0.6;
const ARMUS_LEVEL_TEST_GOALS = ["yds", "ielts", "work", "speaking", "travel", "school"];
const ARMUS_LEVEL_TEST_SKILLS = ["grammar", "vocabulary", "reading"];

const ARMUS_LEVEL_TEST_BANKS = {};

// A pool file calls this with its questions grouped by level and skill:
//   { A1: { grammar: [[prompt, right, wrong, wrong, wrong], ...],
//           vocabulary: [...],
//           reading: [[passage, prompt, right, wrong, wrong, wrong], ...] }, ... }
// Each question gets a steady id (goal-level-skill letter-number), which
// is what the page remembers to avoid repeats.
function armusAddLevelTestBank(goal, levels) {
  const questions = [];
  ARMUS_LEVEL_TEST_LEVELS.forEach(level => {
    const skills = levels[level] || {};
    ARMUS_LEVEL_TEST_SKILLS.forEach(skill => {
      (skills[skill] || []).forEach((row, i) => {
        const id = `${goal}-${level.toLowerCase()}-${skill[0]}${i + 1}`;
        if (skill === "reading") {
          const [passage, prompt, ...options] = row;
          questions.push({ id, goal, level, skill, passage, prompt, options });
        } else {
          const [prompt, ...options] = row;
          questions.push({ id, goal, level, skill, prompt, options });
        }
      });
    });
  });
  ARMUS_LEVEL_TEST_BANKS[goal] = questions;
}

// One goal's pool, or every pool together for no goal (or a goal whose
// file didn't load).
function armusLevelTestBank(goal) {
  if (goal && ARMUS_LEVEL_TEST_BANKS[goal] && ARMUS_LEVEL_TEST_BANKS[goal].length) return ARMUS_LEVEL_TEST_BANKS[goal];
  return ARMUS_LEVEL_TEST_GOALS.reduce((all, g) => all.concat(ARMUS_LEVEL_TEST_BANKS[g] || []), []);
}

function armusLevelTestLevels() {
  return ARMUS_LEVEL_TEST_LEVELS;
}

function armusLevelTestShuffle(items, rnd = Math.random) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// The 20 questions for one sitting, easiest level first. Each comes back
// with `correct` (the right option's text) and its options shuffled.
//   goal  one of ARMUS_LEVEL_TEST_GOALS, or nothing for all pools mixed
//   rnd   the random source (tests pass a seeded one)
//   seen  ids this browser was already asked; they're drawn last
function armusDrawLevelTest({ goal = null, rnd = Math.random, seen = [] } = {}) {
  const bank = armusLevelTestBank(goal);
  const seenIds = new Set(seen);
  const drawn = [];
  ARMUS_LEVEL_TEST_LEVELS.forEach(level => {
    const want = ARMUS_LEVEL_TEST_PLAN[level];
    const fresh = {};
    const old = {};
    armusLevelTestShuffle(bank.filter(q => q.level === level), rnd).forEach(q => {
      const into = seenIds.has(q.id) ? old : fresh;
      (into[q.skill] = into[q.skill] || []).push(q);
    });
    const skills = armusLevelTestShuffle(ARMUS_LEVEL_TEST_SKILLS.filter(s => fresh[s] || old[s]), rnd);
    const picked = [];
    // one of each skill first, so every level mixes them (a new one if
    // there is one), then the rest round-robin: new questions before any
    // this browser has seen
    skills.forEach(s => {
      const q = (fresh[s] || []).shift() || (old[s] || []).shift();
      if (q && picked.length < want) picked.push(q);
    });
    [fresh, old].forEach(lists => {
      while (picked.length < want && skills.some(s => (lists[s] || []).length)) {
        skills.forEach(s => {
          if (picked.length < want && (lists[s] || []).length) picked.push(lists[s].shift());
        });
      }
    });
    armusLevelTestShuffle(picked, rnd).forEach(q => {
      drawn.push({ ...q, correct: q.options[0], options: armusLevelTestShuffle(q.options, rnd) });
    });
  });
  return drawn;
}

// answers[i]: the option text picked for questions[i], or null (skipped /
// timed out).
function armusScoreLevelTest(questions, answers) {
  const perLevel = {};
  const perSkill = {};
  let correct = 0;
  let skipped = 0;
  questions.forEach((q, i) => {
    const answer = answers[i];
    const right = answer !== null && answer !== undefined && answer === q.correct;
    if (answer === null || answer === undefined) skipped++;
    if (right) correct++;
    perLevel[q.level] = perLevel[q.level] || { asked: 0, right: 0 };
    perLevel[q.level].asked++;
    if (right) perLevel[q.level].right++;
    perSkill[q.skill] = perSkill[q.skill] || { asked: 0, right: 0 };
    perSkill[q.skill].asked++;
    if (right) perSkill[q.skill].right++;
  });

  let index = 0;
  let rightSoFar = 0;
  let askedSoFar = 0;
  ARMUS_LEVEL_TEST_LEVELS.forEach((level, i) => {
    const l = perLevel[level];
    if (!l) return;
    rightSoFar += l.right;
    askedSoFar += l.asked;
    if (l.right / l.asked >= ARMUS_LEVEL_TEST_PASS && rightSoFar / askedSoFar >= ARMUS_LEVEL_TEST_PASS) index = i;
  });
  const pct = skill => (perSkill[skill] ? Math.round((perSkill[skill].right / perSkill[skill].asked) * 100) : 0);

  return {
    level: ARMUS_LEVEL_TEST_LEVELS[index],
    next: ARMUS_LEVEL_TEST_LEVELS[index + 1] || null,
    correct,
    skipped,
    skills: { grammar: pct("grammar"), vocabulary: pct("vocabulary"), reading: pct("reading") },
  };
}

// The skill to work on first: the lowest score, grammar first on a tie
// (it holds the rest up).
function armusLevelTestWeakestSkill(skills) {
  return ["grammar", "vocabulary", "reading"].reduce((weakest, skill) => (skills[skill] < skills[weakest] ? skill : weakest), "grammar");
}
