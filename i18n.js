/*
 * ARMUS - lightweight client-side EN/TR toggle.
 *
 * Turkish is the page's native language (every page is authored in
 * Turkish), so this only ever needs an English dictionary, keyed by a
 * short id: ARMUS_I18N_EN["nav.teachers"] etc. An element opts in with
 * data-i18n="that.key" (swaps textContent) or data-i18n-placeholder
 * (swaps an input's placeholder instead). The very first time an
 * element is translated, its original Turkish text/placeholder is
 * cached on the element itself (data-tr-text / data-tr-placeholder) so
 * switching back to Turkish restores it exactly, without needing a
 * parallel Turkish dictionary that could drift from the real markup.
 *
 * Persisted in localStorage, so the choice carries across pages.
 * Requires nothing else - safe to load on any page, translates
 * whatever data-i18n elements that page happens to have (zero is fine).
 */

const ARMUS_I18N_EN = {
  // shared nav
  "nav.teachers": "Teachers",
  "nav.how": "How It Works",
  "nav.about": "About Us",
  "nav.login": "Log In",
  "nav.register": "Sign Up",
  "nav.help": "Help",

  // index.html
  "index.eyebrow": "Turkey's English learning platform",
  "index.hero.title1": "A better way",
  "index.hero.title2": "to learn English.",
  "index.hero.subtitle": "Find the right English teacher for you. Pick your lesson based on your goal, level and budget.",
  "index.hero.cta": "Find a Teacher",
  "index.hero.social": "students are learning English with ARMUS",
  "index.trial": "Book Trial Lesson",
  "index.proof.title": "Thousands of students, hundreds of teachers.<br>Personal and proven progress.",
  "index.proof.fact1": "96% of students say practicing with a real teacher is essential to their progress.",
  "index.proof.fact1.source": "ARMUS student survey",
  "index.proof.fact2": "94% of students improved their fluency with just two lessons a week.",
  "index.proof.fact2.source": "ARMUS student survey",
  "index.proof.fact3": "“Thanks to ARMUS my confidence grew - I realized I could really do this.”",
  "index.proof.fact3.source": "— An ARMUS student",
  "index.how.label": "HOW IT WORKS",
  "index.how.title": "Start learning English<br>in 3 steps.",
  "index.how.step1.title": "Find your teacher.",
  "index.how.step1.text": "We match you with a teacher who'll motivate you, challenge you, and get you to your goals - from your first lesson to fluency.",
  "index.how.step2.title": "Start your lesson.",
  "index.how.step2.text": "Your teacher personalizes every lesson to your goals, so progress feels personal from the very first lesson.",
  "index.how.step3.title": "Improve every week.",
  "index.how.step3.text": "Choose how many lessons you want, and build lasting confidence through regular practice.",
  "index.promise.title": "Lessons you'll love. Guaranteed.",
  "index.promise.text": "Not happy? Try another teacher for free.",
  "index.teacherCta.label": "FOR TEACHERS",
  "index.teacherCta.title": "Do you teach English?",
  "index.teacherCta.text": "Set your own price, build your own schedule, and find your students on ARMUS.",
  "index.teacherCta.point1": "Find new students",
  "index.teacherCta.point2": "Grow your business",
  "index.teacherCta.point3": "Get paid securely",
  "index.teacherCta.cta": "Become a Teacher on ARMUS →",
  "index.teacherCta.link": "See how our platform works",
  "index.commission.label": "COMMISSION RATES",
  "index.commission.title": "Teach more lessons,<br>pay less commission.",
  "index.commission.tier1": "500+ hours",
  "index.commission.tier2": "300–500 hours",
  "index.commission.tier3": "200–300 hours",
  "index.commission.tier4": "100–200 hours",
  "index.commission.tier5": "0–100 hours",
  "index.testimonials.label": "WHAT OUR STUDENTS SAY",
  "index.footer.tagline": "A better way to learn English.",
  "index.footer.students": "Students",
  "index.footer.findTeachers": "Teachers",
  "index.footer.trial": "Trial Lesson",
  "index.footer.how": "How It Works",
  "index.footer.help": "Help Center",
  "index.footer.teachers": "Teachers",
  "index.footer.becomeTeacher": "Become a Teacher",
  "index.footer.commission": "Commission Rates",
  "index.footer.teacherGuide": "Teacher Guide",
  "index.footer.faq": "FAQ",
  "index.footer.about": "About Us",
  "index.footer.aboutUs": "About Us",
  "index.footer.career": "Careers",
  "index.footer.contact": "Contact",
  "index.footer.privacy": "Privacy Policy",
  "index.footer.terms": "Terms of Use",
  "index.footer.newsletter": "Join Our Newsletter",
  "index.footer.newsletterText": "Stay up to date on new features and offers.",
  "index.footer.copyright": "© 2026 ARMUS. All rights reserved.",
};

function armusGetLang() {
  try { return localStorage.getItem("armusLang") || "tr"; } catch (e) { return "tr"; }
}

function armusApplyTranslations() {

  const lang = armusGetLang();

  document.querySelectorAll("[data-i18n]").forEach(el => {

    if (el.dataset.trText === undefined) el.dataset.trText = el.innerHTML;

    const key = el.dataset.i18n;
    const value = ARMUS_I18N_EN[key];

    el.innerHTML = (lang === "en" && value !== undefined) ? value : el.dataset.trText;
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {

    if (el.dataset.trPlaceholder === undefined) el.dataset.trPlaceholder = el.getAttribute("placeholder") || "";

    const key = el.dataset.i18nPlaceholder;
    const value = ARMUS_I18N_EN[key];

    el.setAttribute("placeholder", (lang === "en" && value !== undefined) ? value : el.dataset.trPlaceholder);
  });

  document.querySelectorAll("[data-lang-toggle]").forEach(el => {
    el.textContent = lang === "tr" ? "EN" : "TR";
  });

  document.documentElement.lang = lang;
}

function armusSetLang(lang) {
  try { localStorage.setItem("armusLang", lang); } catch (e) {}
  armusApplyTranslations();
}

document.addEventListener("DOMContentLoaded", () => {

  armusApplyTranslations();

  document.querySelectorAll("[data-lang-toggle]").forEach(el => {
    el.addEventListener("click", () => {
      armusSetLang(armusGetLang() === "tr" ? "en" : "tr");
    });
  });
});
