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
  "nav.backHome": "← Back home",

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

  // login.html
  "login.eyebrow": "WELCOME BACK",
  "login.title": "Log in",
  "login.emailLabel": "Email",
  "login.emailPlaceholder": "you@example.com",
  "login.passwordLabel": "Password",
  "login.passwordPlaceholder": "Your password",
  "login.forgot": "Forgot my password",
  "login.submit": "Log In",
  "login.switchText": "Don't have an account?",
  "login.switchLink": "Sign up",

  // register.html
  "register.eyebrow": "JOIN ARMUS",
  "register.title": "Create an account",
  "register.roleStudent": "As a student",
  "register.roleTeacher": "As a teacher",
  "register.nameLabel": "Full name",
  "register.namePlaceholder": "Your full name",
  "register.emailLabel": "Email",
  "register.emailPlaceholder": "you@example.com",
  "register.cityLabel": "City",
  "register.cityOptional": "(optional)",
  "register.cityNone": "I'd rather not say",
  "register.passwordLabel": "Password",
  "register.passwordPlaceholder": "At least 6 characters",
  "register.password2Label": "Confirm password",
  "register.password2Placeholder": "Re-type your password",
  "register.submit": "Create Account",
  "register.switchText": "Already have an account?",
  "register.switchLink": "Log in",
  "register.verifyEyebrow": "LAST STEP",
  "register.verifyTitle": "Verify your email",
  "register.verifyCodeLabel": "Verification code",
  "register.verifyCodePlaceholder": "6-digit code",
  "register.verifySubmit": "Verify",
  "register.resendText": "Didn't get a code?",
  "register.resendLink": "Resend code",

  // hakkimizda.html
  "about.eyebrow": "ABOUT US",
  "about.title": "We're building a better way to learn English.",
  "about.intro": "ARMUS is a platform that matches Turkish-speaking students with the right English teacher. Instead of crowded classes or a one-size-fits-all curriculum, you move forward one-on-one with a teacher chosen for your goal, level and budget.",
  "about.stat1": "active students",
  "about.stat2": "approved teachers",
  "about.stat3": "of students find practicing with a teacher helpful",
  "about.stat4": "provinces with students and teachers",
  "about.missionLabel": "OUR MISSION",
  "about.missionTitle": "Accessible, personal English education for everyone.",
  "about.missionText": "Working with a good teacher is the fastest way to learn English - but in Turkey, finding the right one is usually left to chance. We built ARMUS as a platform where students can choose a teacher based on their goal, test the fit with a trial lesson before committing, and take lessons whenever they want.",
  "about.valuesLabel": "OUR VALUES",
  "about.valuesTitle": "The three things that define us.",
  "about.value1Title": "Personalized matching",
  "about.value1Text": "We offer filters and a trial lesson so you find a teacher suited to your level, goal and budget - matched with the right person, not dropped into a random class.",
  "about.value2Title": "Transparent pricing",
  "about.value2Text": "Teachers set their own price, and the commission rate drops transparently as they teach more hours. No hidden fees on the student's side.",
  "about.value3Title": "Proven progress",
  "about.value3Text": "With lesson history, a vocabulary vault and speaking-confidence tracking, you can actually see your progress - not just that you took a lesson, but how much you've improved.",
  "about.teacherBannerTitle": "Do you teach English?",
  "about.teacherBannerText": "Set your own price, build your own schedule, and find new students on ARMUS.",
  "about.teacherBannerCta": "Become a Teacher →",

  // iletisim.html
  "contact.eyebrow": "CONTACT",
  "contact.title": "Get in touch",
  "contact.intro": "Have a question, suggestion or complaint? Reach us using the info below or the form, and we'll get back to you as soon as we can.",
  "contact.emailLabel": "Email",
  "contact.hoursLabel": "Support hours",
  "contact.hoursValue": "Weekdays 09:00 – 18:00",
  "contact.nameLabel": "Full name",
  "contact.emailFieldLabel": "Email",
  "contact.messageLabel": "Your message",
  "contact.submit": "Send",
  "contact.sentMsg": "Your message was received, thanks! We'll get back to you as soon as we can.",

  // apply-teacher.html (gate only - the application wizard itself isn't translated yet)
  "applyTeacher.gateTitle": "This page is for teachers",
  "applyTeacher.gateText": "You need to register as a teacher before you can apply.",
  "applyTeacher.gateCta": "Register as a Teacher",
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
