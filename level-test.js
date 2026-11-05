/*
 * ARMUS - the free level test (seviye-testi.html): the question bank, the
 * 20-question draw and the scoring. No DOM here - the page does the
 * screens, this file only decides what to ask and what the answers mean,
 * so tests/level-test.test.js can check it directly.
 *
 * A test is 20 questions from easy to hard: 3 A1, 3 A2, 4 B1, 4 B2, 3 C1,
 * 3 C2, drawn from 8 per level so a retake isn't the same test, and mixed
 * across grammar, vocabulary and reading within each level. In the bank,
 * options[0] is always the right answer; the draw shuffles them.
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

const ARMUS_LEVEL_TEST_BANK = [
  // ---- A1 ----
  { id: "a1-g1", level: "A1", skill: "grammar", prompt: "She ___ a teacher.", options: ["is", "am", "are", "be"] },
  { id: "a1-g2", level: "A1", skill: "grammar", prompt: "There ___ two cats in the garden.", options: ["are", "is", "am", "be"] },
  { id: "a1-g3", level: "A1", skill: "grammar", prompt: "___ you like pizza?", options: ["Do", "Does", "Are", "Is"] },
  { id: "a1-g4", level: "A1", skill: "grammar", prompt: "I ___ to work by bus every day.", options: ["go", "goes", "going", "gone"] },
  { id: "a1-v1", level: "A1", skill: "vocabulary", prompt: "My mother's brother is my ___.", options: ["uncle", "cousin", "nephew", "aunt"] },
  { id: "a1-v2", level: "A1", skill: "vocabulary", prompt: "The opposite of *hot* is ___.", options: ["cold", "warm", "wet", "high"] },
  { id: "a1-v3", level: "A1", skill: "vocabulary", prompt: "We have breakfast in the ___.", options: ["morning", "evening", "night", "afternoon"] },
  { id: "a1-r1", level: "A1", skill: "reading", passage: "Hi, I'm Tom. I'm 25 years old and I live in London with my sister. I work in a bank, and on Saturdays I play football.", prompt: "What does Tom do on Saturdays?", options: ["He plays football.", "He works in a bank.", "He visits his sister.", "He goes to London."] },

  // ---- A2 ----
  { id: "a2-g1", level: "A2", skill: "grammar", prompt: "Yesterday we ___ to the cinema.", options: ["went", "go", "gone", "goes"] },
  { id: "a2-g2", level: "A2", skill: "grammar", prompt: "This book is ___ than that one.", options: ["more interesting", "interesting", "most interesting", "the most interesting"] },
  { id: "a2-g3", level: "A2", skill: "grammar", prompt: "I have never ___ sushi.", options: ["eaten", "ate", "eat", "eating"] },
  { id: "a2-g4", level: "A2", skill: "grammar", prompt: "Look at those dark clouds. It ___ rain.", options: ["is going to", "goes to", "will to", "going to"] },
  { id: "a2-v1", level: "A2", skill: "vocabulary", prompt: "It's cold in here. Can you ___ the window, please?", options: ["close", "open", "wear", "break"] },
  { id: "a2-v2", level: "A2", skill: "vocabulary", prompt: "I'm really ___ because I didn't sleep last night.", options: ["tired", "hungry", "angry", "excited"] },
  { id: "a2-v3", level: "A2", skill: "vocabulary", prompt: "Could you ___ me your pen? I forgot mine.", options: ["lend", "borrow", "take", "keep"] },
  { id: "a2-r1", level: "A2", skill: "reading", passage: "The City Museum is open from Tuesday to Sunday, 10:00 to 18:00. It is closed on Mondays. Tickets are free for children under 12.", prompt: "When is the museum closed?", options: ["On Mondays", "On Sundays", "Every morning", "After 16:00"] },

  // ---- B1 ----
  { id: "b1-g1", level: "B1", skill: "grammar", prompt: "If I ___ more free time, I would learn to play the guitar.", options: ["had", "have", "will have", "would have"] },
  { id: "b1-g2", level: "B1", skill: "grammar", prompt: "I've been living in this city ___ 2019.", options: ["since", "for", "from", "during"] },
  { id: "b1-g3", level: "B1", skill: "grammar", prompt: "The film was ___ boring that we left early.", options: ["so", "such", "too", "very"] },
  { id: "b1-g4", level: "B1", skill: "grammar", prompt: "He said he ___ tired, so he went to bed early.", options: ["was", "is", "were", "been"] },
  { id: "b1-v1", level: "B1", skill: "vocabulary", prompt: "Don't worry if you ___ a mistake. Everyone does.", options: ["make", "do", "take", "have"] },
  { id: "b1-v2", level: "B1", skill: "vocabulary", prompt: "Can you ___ after my cat while I'm on holiday?", options: ["look", "take", "care", "watch"] },
  { id: "b1-v3", level: "B1", skill: "vocabulary", prompt: "She's very ___. She never tells lies.", options: ["honest", "polite", "lazy", "shy"] },
  { id: "b1-r1", level: "B1", skill: "reading", passage: "Many people now work from home at least two days a week. While this saves time on travel, some employees say they miss the energy of the office and find it harder to separate work from free time.", prompt: "What do some employees say about working from home?", options: ["It is harder to keep work and free time apart.", "It takes more time than going to the office.", "They have more energy at home.", "They would like to travel more."] },

  // ---- B2 ----
  { id: "b2-g1", level: "B2", skill: "grammar", prompt: "By the time we arrived, the film ___.", options: ["had already started", "already started", "has already started", "was already starting"] },
  { id: "b2-g2", level: "B2", skill: "grammar", prompt: "I wish I ___ so much money last weekend.", options: ["hadn't spent", "didn't spend", "haven't spent", "wouldn't spend"] },
  { id: "b2-g3", level: "B2", skill: "grammar", prompt: "___ the bad weather, the match went ahead.", options: ["Despite", "Although", "However", "Even"] },
  { id: "b2-g4", level: "B2", skill: "grammar", prompt: "She is used to ___ early in the morning.", options: ["working", "work", "worked", "works"] },
  { id: "b2-v1", level: "B2", skill: "vocabulary", prompt: "The meeting has been ___ until next Monday.", options: ["put off", "put up", "put on", "put out"] },
  { id: "b2-v2", level: "B2", skill: "vocabulary", prompt: "Choose the word closest in meaning to *reluctant*.", options: ["unwilling", "eager", "tired", "careful"] },
  { id: "b2-v3", level: "B2", skill: "vocabulary", prompt: "The new law will have a significant ___ on small businesses.", options: ["impact", "affect", "effort", "result"] },
  { id: "b2-r1", level: "B2", skill: "reading", passage: "Electric scooters have become common in many cities. Supporters say they reduce traffic and pollution, but critics point out that they are often left on pavements, where they can be dangerous for pedestrians. Some cities now require users to park them in special areas.", prompt: "What problem do critics mention?", options: ["They are left where people walk.", "They cause more pollution than cars.", "They are too expensive to rent.", "They can only be used in special areas."] },

  // ---- C1 ----
  { id: "c1-g1", level: "C1", skill: "grammar", prompt: "Not only ___ late, but he also forgot the documents.", options: ["did he arrive", "he arrived", "he did arrive", "arrived he"] },
  { id: "c1-g2", level: "C1", skill: "grammar", prompt: "Had I known about the traffic, I ___ earlier.", options: ["would have left", "would leave", "had left", "will have left"] },
  { id: "c1-g3", level: "C1", skill: "grammar", prompt: "It's high time we ___ a decision about this.", options: ["made", "make", "will make", "have made"] },
  { id: "c1-g4", level: "C1", skill: "grammar", prompt: "The report, ___ was published yesterday, has caused quite a stir.", options: ["which", "that", "what", "who"] },
  { id: "c1-v1", level: "C1", skill: "vocabulary", prompt: "The minister's comments sparked widespread ___ among teachers.", options: ["outrage", "outcome", "outlook", "outset"] },
  { id: "c1-v2", level: "C1", skill: "vocabulary", prompt: "The findings are ___ with earlier research in the field.", options: ["consistent", "persistent", "insistent", "resistant"] },
  { id: "c1-v3", level: "C1", skill: "vocabulary", prompt: "She was ___ to accept the offer, as the salary was much lower than she had expected.", options: ["hesitant", "eager", "delighted", "keen"] },
  { id: "c1-r1", level: "C1", skill: "reading", passage: "Although remote learning was initially seen as a temporary solution, many universities have since adopted hybrid models. Advocates argue that this flexibility widens access; skeptics, however, question whether online seminars can replicate the spontaneous exchanges of a physical classroom.", prompt: "What do the skeptics doubt?", options: ["That online seminars can match the unplanned discussion of a real classroom", "That hybrid models make university easier to access", "That universities have adopted hybrid models", "That remote learning was meant to be temporary"] },

  // ---- C2 ----
  { id: "c2-g1", level: "C2", skill: "grammar", prompt: "Little ___ that the decision would change her life forever.", options: ["did she know", "she knew", "she did know", "knew she"] },
  { id: "c2-g2", level: "C2", skill: "grammar", prompt: "Were the government ___ taxes, prices would fall.", options: ["to cut", "cutting", "cut", "cuts"] },
  { id: "c2-g3", level: "C2", skill: "grammar", prompt: "Scarcely ___ the house when it started to pour.", options: ["had we left", "we had left", "did we leave", "we left"] },
  { id: "c2-v1", level: "C2", skill: "vocabulary", prompt: "His argument, though eloquent, was ultimately ___: it fell apart under close scrutiny.", options: ["specious", "spacious", "gracious", "precious"] },
  { id: "c2-v2", level: "C2", skill: "vocabulary", prompt: "The talks reached an ___, with neither side willing to compromise.", options: ["impasse", "impulse", "impetus", "imprint"] },
  { id: "c2-v3", level: "C2", skill: "vocabulary", prompt: "She has a real ___ for languages; she picked up Turkish in under a year.", options: ["flair", "flare", "flavour", "fluke"] },
  { id: "c2-v4", level: "C2", skill: "vocabulary", prompt: "The proposal won ___ approval: not a single member voted against it.", options: ["unanimous", "anonymous", "ubiquitous", "ambiguous"] },
  { id: "c2-r1", level: "C2", skill: "reading", passage: "The author contends that the much-vaunted efficiency of open-plan offices is largely illusory: whatever is gained in casual collaboration is more than offset by the cost of constant interruption.", prompt: "What is the author's view of open-plan offices?", options: ["Their drawbacks outweigh their benefits.", "They greatly improve efficiency.", "They reduce interruptions.", "They have no effect on collaboration."] },
];

function armusLevelTestBank() {
  return ARMUS_LEVEL_TEST_BANK;
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
function armusDrawLevelTest(rnd = Math.random) {
  const drawn = [];
  ARMUS_LEVEL_TEST_LEVELS.forEach(level => {
    const want = ARMUS_LEVEL_TEST_PLAN[level];
    const bySkill = {};
    armusLevelTestShuffle(ARMUS_LEVEL_TEST_BANK.filter(q => q.level === level), rnd)
      .forEach(q => (bySkill[q.skill] = bySkill[q.skill] || []).push(q));
    // round-robin across skills so every level mixes them
    const skills = armusLevelTestShuffle(Object.keys(bySkill), rnd);
    const picked = [];
    while (picked.length < want && skills.some(s => bySkill[s].length)) {
      skills.forEach(s => {
        if (picked.length < want && bySkill[s].length) picked.push(bySkill[s].shift());
      });
    }
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
