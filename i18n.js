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
  "nav.messages": "Messages",
  "nav.logout": "Log Out",

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

  // gizlilik-politikasi.html
  "privacy.eyebrow": "LEGAL",
  "privacy.title": "Privacy Policy",
  "privacy.updated": "Last updated: 15.08.2026",
  "privacy.intro": "This Privacy Policy explains what personal data we collect while you use ARMUS (\"we\", \"the platform\"), why and how we process it, and what rights you have. ARMUS is a platform that matches students who want to learn English in Turkey with English teachers.",
  "privacy.s1Title": "1. What data do we collect?",
  "privacy.s1Intro": "Depending on your account and how you use the platform, we may collect:",
  "privacy.s1Li1": "Name, surname, email address and password (when you create an account)",
  "privacy.s1Li2": "For teachers: country, subject taught, languages spoken, phone number, photo, certificate and education information, intro video",
  "privacy.s1Li3": "Lesson history, booking information and student reviews",
  "privacy.s1Li4": "Once the payment system is live: billing and payment information (card numbers are never stored by us directly - they're processed through the payment provider)",
  "privacy.s2Title": "2. Why do we process your data?",
  "privacy.s2Li1": "To create your account and let you use the platform",
  "privacy.s2Li2": "To review and approve teacher applications",
  "privacy.s2Li3": "To run the booking, lesson and review systems",
  "privacy.s2Li4": "To prevent fraud and abuse",
  "privacy.s2Li5": "To meet our legal obligations",
  "privacy.s3Title": "3. Who do we share your data with?",
  "privacy.s3Text": "We don't share your data with third parties unless it's necessary to provide the service. For example, a teacher's profile is shown publicly the way students considering a lesson would see it (name, photo, bio, reviews, etc). With the service providers we use for payment and hosting infrastructure, data is shared only to the extent necessary to provide that service.",
  "privacy.s4Title": "4. Where do we store your data?",
  "privacy.s4Text": "Your data is stored in a secure database hosted on Supabase's infrastructure, protected by row-level access rules (Row Level Security) - meaning every user can only access their own data, and other users' public information (like a teacher's profile) only to the extent the platform allows.",
  "privacy.s5Title": "5. Your rights (KVKK)",
  "privacy.s5Text": "Under Turkey's Personal Data Protection Law No. 6698 (\"KVKK\"), you have the right to learn whether your data is processed, request information about it if it is, and request that your data be deleted or corrected. You can contact us to exercise these rights.",
  "privacy.s6Title": "6. Contact us",
  "privacy.s6Text": "For questions about this privacy policy, you can reach us through our <a href=\"iletisim.html\">contact page</a>.",
  "privacy.note": "ARMUS is currently in active development. This document will be updated as the platform grows and its payment infrastructure goes live.",

  // kullanim-sartlari.html
  "terms.eyebrow": "LEGAL",
  "terms.title": "Terms of Use",
  "terms.updated": "Last updated: 15.08.2026",
  "terms.intro": "These Terms of Use apply to students and teachers who use the ARMUS platform. By using the platform, you agree to these terms.",
  "terms.s1Title": "1. Accounts",
  "terms.s1Text": "You agree that the information you provide when creating an account is accurate. You're responsible for keeping your password confidential and for any activity on your account. Anyone under 18 may not apply as a teacher.",
  "terms.s2Title": "2. Teacher application and approval process",
  "terms.s2Text": "Users who register as a teacher fill out an application form (identity information, photo, optional certificate/education info, intro video) before their profile can be published on the Teachers page. The ARMUS team reviews this application and approves or rejects it. ARMUS reserves the right to reject any application without stating a reason, or to remove an already-approved profile later.",
  "terms.s3Title": "3. Bookings and lessons",
  "terms.s3Text": "Students book a lesson by choosing one of the time slots the teacher has made available. A lesson lasts 50 minutes. Cancellation and rescheduling terms after a booking is made will be set separately as the platform develops. If a student doesn't show up for a booked lesson, the lesson fee is still charged, since the teacher's time was reserved.",
  "terms.s4Title": "4. Trial lesson",
  "terms.s4Text": "The trial lesson is designed for a student to meet a teacher for the first time. If the student continues taking regular lessons with that teacher after the trial, the trial lesson fee is passed on to the teacher. If the student doesn't continue, the trial lesson fee stays with ARMUS. A teacher directing students to only book a trial lesson and then arranging things off-platform afterward is a violation of these terms and can lead to account suspension.",
  "terms.s5Title": "5. Commission rates",
  "terms.s5Text": "ARMUS takes a commission from every lesson at the following rates, based on a teacher's total completed successful lesson hours:",
  "terms.s5Th1": "Successful lesson hours",
  "terms.s5Th2": "Commission",
  "terms.s6Title": "6. Prohibited conduct",
  "terms.s6Li1": "Applying with false information or documents",
  "terms.s6Li2": "Directing students or teachers to pay outside the platform",
  "terms.s6Li3": "Harassing, discriminatory or inappropriate behavior",
  "terms.s6Li4": "Creating fake reviews or bookings",
  "terms.s7Title": "7. Limitation of liability",
  "terms.s7Text": "ARMUS is currently in an early stage. The platform is provided \"as is\"; uninterrupted or error-free operation is not guaranteed. Teachers are responsible for the quality of lessons given, and students for the quality of their own learning.",
  "terms.s8Title": "8. Changes",
  "terms.s8Text": "We may update these terms from time to time. We'll try to notify you of significant changes.",
  "terms.note": "ARMUS is currently in active development. This document will be updated, and reviewed by legal counsel, as the platform grows and moves to real payment/legal infrastructure.",

  // sss.html
  "faq.eyebrow": "HELP",
  "faq.title": "Frequently Asked Questions",
  "faq.intro": "The most common questions from students and teachers, answered. Can't find what you're looking for? Get in touch.",
  "faq.studentsLabel": "For students",
  "faq.q1": "How do I book a lesson on ARMUS?",
  "faq.a1": "Pick a teacher that suits you from the Teachers page, then book by choosing an available date and time on their profile. You need to create a free account first to book.",
  "faq.q2": "How long does a lesson last?",
  "faq.a2": "A standard lesson lasts 50 minutes.",
  "faq.q3": "What is a trial lesson?",
  "faq.a3": "A trial lesson is a lower-priced first lesson designed for meeting a teacher for the first time. If you're happy with the trial, you can continue taking regular lessons with the same teacher.",
  "faq.q4": "Where can I see my bookings?",
  "faq.a4": "Once you're logged in, you can see all your past and upcoming bookings on the \"My Lessons\" page.",
  "faq.q5": "How do I review a lesson I took?",
  "faq.a5": "After the lesson date has passed, you'll see a \"Review this lesson\" button under that lesson on the \"My Lessons\" page - you can give a star rating and write a comment.",
  "faq.q6": "What happens if I miss a lesson?",
  "faq.a6": "Since the teacher's time was reserved for that slot, lessons you miss are still charged. See our Terms of Use page for details.",
  "faq.teachersLabel": "For teachers",
  "faq.q7": "How do I become a teacher on ARMUS?",
  "faq.a7": "Click the \"Become a Teacher\" button to create an account first, then fully fill out the application form (personal info, photo, certificate/education info, intro video, bio, availability and price). Once your application is reviewed and approved by the ARMUS team, your profile is published on the Teachers page.",
  "faq.q8": "How long does my application take to review?",
  "faq.a8": "Applications are usually reviewed within a few business days. You'll be notified of the result by email and in your dashboard.",
  "faq.q9": "What do I need for my intro video?",
  "faq.a9": "The video should be at least 60 seconds long and shot in landscape orientation, and the file size shouldn't exceed 20 MB.",
  "faq.q10": "Is there a rule for my bio?",
  "faq.a10": "Yes, the bio must be at least 400 characters. This makes sure you give students enough information to get to know you.",
  "faq.q11": "How much commission does ARMUS take?",
  "faq.a11": "The commission rate drops in tiers based on your total completed successful lesson hours: 30% for 0–100 hours, 28% for 100–200 hours, 25% for 200–300 hours, 20% for 300–500 hours, 15% above 500 hours. See the earnings summary in your dashboard and our Terms of Use page for details.",
  "faq.q12": "How do I set my availability?",
  "faq.a12": "In the \"Weekly availability\" section of your teacher dashboard, mark and save the days and times you want to teach. Students only see these times when booking.",
  "faq.ctaText": "Couldn't find the answer you were looking for?",
  "faq.ctaBtn": "Contact us",

  // 404.html
  "notFound.title": "We couldn't find this page",
  "notFound.text": "The page you're looking for may have moved, or never existed. You can head back to the homepage and continue from there.",
  "notFound.home": "Back to Homepage",
  "notFound.teachers": "See Teachers",

  // sifre-sifirla.html
  "nav.backLogin": "← Back to login",
  "resetPw.eyebrow": "GET BACK TO YOUR ACCOUNT",
  "resetPw.title": "Reset your password",
  "resetPw.subtitle": "Enter your email and we'll send you a reset link.",
  "resetPw.requestSuccess": "If this email is registered with ARMUS, you'll get an email with a reset link within a few minutes.",
  "resetPw.emailLabel": "Email",
  "resetPw.emailPlaceholder": "you@example.com",
  "resetPw.requestBtn": "Send Reset Link",
  "resetPw.rememberedText": "Remembered your password?",
  "resetPw.rememberedLink": "Log in",
  "resetPw.step2Eyebrow": "LAST STEP",
  "resetPw.step2Title": "Set a new password",
  "resetPw.step2Subtitle": "Choose a new password for your account.",
  "resetPw.updateSuccess": "Your password was updated. Redirecting you to the login page...",
  "resetPw.newPasswordLabel": "New password",
  "resetPw.newPasswordPlaceholder": "At least 6 characters",
  "resetPw.newPasswordAgainLabel": "New password (again)",
  "resetPw.newPasswordAgainPlaceholder": "Re-type your new password",
  "resetPw.updateBtn": "Update Password",

  // booking.html (static shell only - dynamic slot/date/price text stays as rendered by JS)
  "nav.backTeachers": "← Back to teachers",
  "booking.notFoundTitle": "Teacher not found",
  "booking.notFoundText": "The teacher you're trying to book doesn't exist.",
  "booking.notFoundLink": "← Back to teachers",
  "booking.gateTitle": "You need to log in to book",
  "booking.gateText": "You need an account before you can pick a lesson time.",
  "booking.gateLogin": "Log In",
  "booking.gateRegister": "Sign Up",
  "booking.perLesson": "/ 50 minutes",
  "booking.step1Title": "Pick a date",
  "booking.step2Title": "Pick a time",
  "booking.step2Note": "(50-minute lesson)",
  "booking.confirmTeacher": "Teacher",
  "booking.confirmDate": "Date",
  "booking.confirmTime": "Time",
  "booking.confirmPrice": "Price",
  "booking.confirmCreditRow": "With your lesson credit",
  "booking.confirmCreditApplied": "Free",
  "booking.payerPhoneLabel": "Phone number",
  "booking.payerIdentityLabel": "National ID number",
  "booking.confirmNote": "You'll be redirected to a secure payment page",
  "booking.successText": "Your spot is reserved, no teacher approval needed.",
  "booking.successMyLessons": "See my lessons",
  "booking.successOtherTeachers": "Browse other teachers",
  "booking.pageTitleTrial": "Trial Lesson",
  "booking.pageTitleRegular": "Booking",
  "booking.flowLabelTrial": "TRIAL LESSON",
  "booking.flowLabelRegular": "BOOKING",
  "booking.flowTitleTrial": "Pick a time for your trial lesson",
  "booking.flowTitleRegular": "Pick a lesson time",
  "booking.successTitleTrial": "Your trial lesson is booked",
  "booking.successTitleRegular": "Your booking is confirmed",
  "booking.confirmBtnTrial": "Pay for Trial Lesson",
  "booking.confirmBtnRegular": "Proceed to Payment",
  "booking.paymentFailed": "Payment wasn't completed, or was cancelled. No booking was created - you can try again if you'd like.",
  "booking.paymentError": "Your payment went through, but something went wrong creating the booking. Please contact us and we'll sort out your payment.",

  // my-lessons.html (top-level shell only - individual lesson cards,
  // review/dispute forms stay Turkish for now, see note in the code)
  "myLessons.gateTitle": "Log in to see your lessons",
  "myLessons.gateText": "You need an account before you can see your bookings.",
  "myLessons.eyebrow": "MY LESSONS",
  "myLessons.title": "Your bookings",
  "myLessons.emptyText": "You don't have any lessons yet.",
  "myLessons.emptyCta": "Find a teacher →",
  "myLessons.reviewed": "Reviewed",
  "myLessons.reviewPromptBtn": "★ Review this lesson",
  "myLessons.reviewPlaceholder": "How was your lesson with {name}?",
  "myLessons.starAlert": "Please choose a rating.",
  "myLessons.reviewFailedAlert": "Couldn't save your review.",
  "myLessons.disputeStatusOpen": "Reported, under review",
  "myLessons.disputeStatusInProgress": "Under review",
  "myLessons.disputeStatusResolved": "Resolved",
  "myLessons.disputeSubject1": "Teacher didn't show up",
  "myLessons.disputeSubject2": "Issue with lesson quality",
  "myLessons.disputeSubject3": "Communication / inappropriate behavior",
  "myLessons.disputeSubject4": "Payment issue",
  "myLessons.disputeSubject5": "Other",
  "myLessons.reportPromptBtn": "⚑ Report an issue",
  "myLessons.disputePlaceholder": "Briefly describe what happened...",
  "myLessons.disputeAlert": "Please briefly describe what happened.",
  "myLessons.disputeFailedAlert": "Couldn't submit. Please try again.",
  "myLessons.trial": "Trial Lesson",
  "myLessons.lesson": "Lesson",
  "myLessons.pastSuffix": " · past",
  "myLessons.cancelled": "⊘ Cancelled",
  "myLessons.creditAdded": " · Lesson credit added",
  "myLessons.creditNotAdded": " · No lesson credit added",
  "myLessons.joinBtn": "🎥 Join Lesson",
  "myLessons.joinHint": "You'll be able to join the room from this card at lesson time.",
  "myLessons.cancelBtn": "Cancel Lesson",
  "myLessons.cancelling": "Cancelling...",
  "myLessons.refundHintYes": "If you cancel, you'll earn a lesson credit you can use with this teacher (or with someone else for a trial lesson)",
  "myLessons.refundHintNo": "Since it's less than 4 hours until the lesson, no credit is earned",
  "myLessons.cancelConfirm": "Are you sure you want to cancel your lesson with {name} on {date} at {time}?",

  // wallet.html (currently disabled/unreachable in production - top-level shell only)
  "wallet.gateTitle": "Log in to see your wallet",
  "wallet.gateText": "You need an account before you can see your wallet balance.",
  "wallet.eyebrow": "MY WALLET",
  "wallet.title": "My Wallet",
  "wallet.balanceLabel": "CURRENT BALANCE",
  "wallet.balanceNote": "This balance can only be used for lesson bookings and can't be cashed out.",
  "wallet.topupTitle": "Add Money",
  "wallet.customAmountLabel": "Or enter an amount",
  "wallet.customAmountPlaceholder": "e.g. 300",
  "wallet.phoneLabel": "Phone number",
  "wallet.identityLabel": "National ID number",
  "wallet.topupSubmit": "Pay and Add",
  "wallet.historyTitle": "Transaction History",

  // class.html (static state screens only - the live-lesson room bar has
  // no toggle of its own, but already-chosen language still applies)
  "class.tooEarlyTitle": "It's not time for your lesson yet",
  "class.tooEarlyText": "You can enter this room <strong id=\"minutesUntil\"></strong> minutes before your lesson starts.",
  "class.backToLessons": "← Back to my lessons",
  "class.tooLateTitle": "This lesson has ended",
  "class.tooLateText": "This lesson's room time has run out. You can book a new lesson to get a new room.",
  "class.leave": "Leave",
  "class.addWord": "+ Add Word",
  "class.wordPlaceholder": "Word",
  "class.meaningPlaceholder": "Meaning",
  "class.add": "Add",
  "class.cancel": "Cancel",
  "class.wordSaved": "✓ Word saved",
  "class.skip": "Skip",
  "class.saveAndExit": "Save and Exit",

  // mesajlar.html (top-level shell only - conversation list and chat
  // bubbles stay Turkish for now, see note in the code)
  "messages.gateTitle": "Log in to see your messages",
  "messages.gateText": "You need an account before you can message your teachers or students.",
  "messages.title": "Messages",
  "messages.threadPlaceholder": "Pick someone on the left to see your conversation.",
  "messages.attachTitle": "Send a photo/video",
  "messages.micTitle": "Send a voice message",
  "messages.inputPlaceholder": "Write a message...",
  "messages.emptyConvoList": "You don't have any conversations yet. Start one from a teacher's profile with \"Send Message\".",
  "messages.noMessageYet": "No message yet",
  "messages.photo": "📷 Photo",
  "messages.video": "🎥 Video",
  "messages.voiceMessage": "🎤 Voice message",
  "messages.message": "Message",
  "messages.edited": "(edited)",
  "messages.save": "Save",
  "messages.editTitle": "Edit",
  "messages.editExpired": "The window to edit this message has closed (you can edit within 2 minutes of sending).",
  "messages.editDenied": "This message couldn't be edited.",
  "messages.emptyThread": "No messages yet, send the first one.",
  "messages.contactPolicyBlocked": "This message couldn't be sent: sharing phone numbers, email, or off-platform contact info like WhatsApp/Instagram isn't allowed until there's a confirmed lesson booking. Please continue the conversation through ARMUS.",
  "messages.contactPolicyBlockedShort": "This message couldn't be sent: sharing phone numbers, email, or off-platform contact info isn't allowed until there's a confirmed lesson booking.",
  "messages.fileTooBig": "File is too large (max {mb}MB).",
  "messages.fileFailed": "Couldn't send the file. Please try again.",
  "messages.micDenied": "Couldn't access the microphone. Please check your browser permissions.",
  "messages.recordingTooBig": "Voice recording is too large, try a shorter one.",
  "messages.voiceFailed": "Couldn't send the voice message. Please try again.",

  // dashboard.html (teacher dashboard) - sidebar nav, top-level labels
  // only; the dense stats/digest/booking-list panels stay Turkish
  "teacherDash.tag": "TEACHER PANEL",
  "teacherDash.navOverview": "Overview",
  "teacherDash.navBookings": "Bookings",
  "teacherDash.navAvailability": "Availability",
  "teacherDash.navProfile": "Profile",
  "teacherDash.notAvailable": "Not available right now",
  "teacherDash.availableNow": "Available right now",
  "teacherDash.today": "Today",
  "teacherDash.statLessons": "Completed lessons",

  // student-dashboard.html - sidebar/top-level labels only; the stats
  // row, confidence card, flashcards, lesson list, recommendations etc.
  // are all built from JS template literals and stay Turkish for now
  "studentDash.gateTitle": "Log in to see your dashboard",
  "studentDash.gateText": "You need an account before you can see your lessons, progress and recommendations.",
  "studentDash.greetSub": "How about continuing to learn English today?",
  "studentDash.goalTitle": "Your Goal This Week",
  "studentDash.save": "Save",
  "studentDash.confidenceTitle": "Your Speaking Confidence",
  "studentDash.flashcards": "📇 Flashcards",
  "studentDash.badges": "Your Badges",
  "studentDash.upcoming": "Upcoming Lessons",
  "studentDash.seeAll": "See All →",
  "studentDash.allMessages": "All Messages →",
  "studentDash.recommended": "Recommended For You",

  // admin.html - internal staff tool, not visitor-facing. Sidebar nav
  // labels only; the many data tables/charts/panels stay Turkish since
  // the ARMUS team operating this page reads Turkish anyway.
  "admin.tag": "ADMIN PANEL",
  "admin.navOverview": "Overview",
  "admin.navTeachers": "Teachers",
  "admin.navChanges": "Profile Changes",
  "admin.navBookings": "Bookings",
  "admin.navStudents": "Students",
  "admin.navLog": "Activity Log",
  "admin.navTestimonials": "Homepage Reviews",
  "admin.navDisputes": "Disputes",
  "admin.navReviews": "Reviews",
  "admin.navEarnings": "Earnings",
  "admin.navAnnouncement": "Site Announcement",
  "admin.navDemand": "Demand Map",
  "admin.navCities": "Cities",
  "admin.navFlags": "Display Settings",

  // teacher.html (profile page) - calendar expand button
  "teacherProfile.viewFullSchedule": "View full schedule",

  // apply-teacher.html (gate only - the application wizard itself isn't translated yet)
  "applyTeacher.gateTitle": "This page is for teachers",
  "applyTeacher.gateText": "You need to register as a teacher before you can apply.",
  "applyTeacher.gateCta": "Register as a Teacher",
};

function armusGetLang() {
  try { return localStorage.getItem("armusLang") || "tr"; } catch (e) { return "tr"; }
}

// For text a page sets dynamically via JS (e.g. after fetching data),
// where a static data-i18n attribute would just get clobbered on the
// next render. Falls back to the Turkish text if there's no EN entry.
function armusT(key, trFallback) {
  const value = ARMUS_I18N_EN[key];
  return (armusGetLang() === "en" && value !== undefined) ? value : trFallback;
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

  document.querySelectorAll("[data-i18n-title]").forEach(el => {

    if (el.dataset.trTitle === undefined) el.dataset.trTitle = el.getAttribute("title") || "";

    const key = el.dataset.i18nTitle;
    const value = ARMUS_I18N_EN[key];

    el.setAttribute("title", (lang === "en" && value !== undefined) ? value : el.dataset.trTitle);
  });

  document.querySelectorAll("[data-lang-toggle]").forEach(el => {
    el.textContent = lang === "tr" ? "EN" : "TR";
  });

  document.documentElement.lang = lang;
}

function armusSetLang(lang) {
  try { localStorage.setItem("armusLang", lang); } catch (e) {}
  armusApplyTranslations();
  // Lets a page re-render any dynamically-set text (e.g. a string built
  // from teacher/booking data after a fetch) that data-i18n can't reach
  // because JS overwrites it after the fact.
  document.dispatchEvent(new CustomEvent("armus:langchange"));
}

document.addEventListener("DOMContentLoaded", () => {

  armusApplyTranslations();

  document.querySelectorAll("[data-lang-toggle]").forEach(el => {
    el.addEventListener("click", () => {
      armusSetLang(armusGetLang() === "tr" ? "en" : "tr");
    });
  });
});
