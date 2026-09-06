import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Button from '../../components/Button';
import { colors, fonts, goldGradient, radius } from '../../lib/theme';

type CountryOption = { value: string; label: string; flag: string };

type Answers = {
  goal: string | null;
  timeline: string | null;
  industry: string | null;
  jobTitle: string;
  skills: string[];
  topics: string[];
  level: string | null;
  teachingStyle: string[];
  tutorCountry: string | null;
  nativeOnly: boolean;
  otherLanguages: string[];
  days: string[];
  times: string[];
  budget: string | null;
  futureSubjects: string[];
  extraNotes: string;
};

const GOAL_OPTIONS = [
  { value: 'work', label: 'İş için İngilizce öğrenmek' },
  { value: 'speaking', label: 'Konuşma becerimi geliştirmek' },
  { value: 'exam', label: 'Bir sınava hazırlanmak' },
  { value: 'child', label: 'Çocuğum için öğretmen bulmak' },
];

const TIMELINE_OPTIONS = [
  '1-4 hafta',
  '1-3 ay',
  '3-6 ay',
  'Ne kadar sürerse sürsün',
  'Sadece bir derse ihtiyacım var',
];

const INDUSTRY_OPTIONS_BASE = ['Finans / Bankacılık', 'Teknoloji / IT', 'Sağlık', 'Eğitim'];
const INDUSTRY_OPTIONS_ALL = [...INDUSTRY_OPTIONS_BASE, 'Hukuk', 'Pazarlama', 'Perakende', 'Diğer'];

const SKILL_OPTIONS = [
  'Tercih yok',
  'İş yeri iletişimi',
  'Mülakat hazırlığı',
  'Sunumlar',
  'Profesyonel yazma',
  'İlişki kurma',
  'Sektöre özgü dil',
];

const TOPIC_OPTIONS_BASE = [
  'Tercih yok',
  'İş İngilizcesi',
  'Günlük Konuşma İngilizcesi',
  'Yoğun İngilizce',
  'Yeni Başlayanlar için İngilizce',
  'Amerikan İngilizcesi',
];
const TOPIC_OPTIONS_ALL = [...TOPIC_OPTIONS_BASE, 'IELTS', 'YDS', 'TOEFL', 'Dilbilgisi'];

const LEVEL_OPTIONS = ['Yeni başlıyorum', 'Temel bilgim var', 'Günlük konuşabiliyorum', 'Akıcı konuşabiliyorum'];

const STYLE_OPTIONS = [
  'Esnek',
  'Yakın ve samimi',
  'Motive edici',
  'Sürükleyici',
  'Hedef odaklı',
  'Sabırlı',
  'Düzenli',
  'Tercih yok',
];
const MAX_STYLES = 3;

const COUNTRY_OPTIONS_BASE: CountryOption[] = [
  { value: 'any', label: 'Fark etmez', flag: '🌍' },
  { value: 'tr', label: 'Türkiye', flag: '🇹🇷' },
  { value: 'us', label: 'ABD', flag: '🇺🇸' },
  { value: 'uk', label: 'İngiltere', flag: '🇬🇧' },
  { value: 'ca', label: 'Kanada', flag: '🇨🇦' },
  { value: 'au', label: 'Avustralya', flag: '🇦🇺' },
];
const COUNTRY_OPTIONS_ALL: CountryOption[] = [
  ...COUNTRY_OPTIONS_BASE,
  { value: 'ie', label: 'İrlanda', flag: '🇮🇪' },
  { value: 'nz', label: 'Yeni Zelanda', flag: '🇳🇿' },
  { value: 'za', label: 'Güney Afrika', flag: '🇿🇦' },
];

const LANGUAGE_OPTIONS_BASE = ['Tercih yok', 'Türkçe', 'Rusça', 'Arapça', 'İspanyolca', 'Farsça'];
const LANGUAGE_OPTIONS_ALL = [...LANGUAGE_OPTIONS_BASE, 'Almanca', 'Fransızca', 'Çince', 'Korece'];

const DAY_OPTIONS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

const TIME_OPTIONS = [
  { value: 'morning', label: 'Sabah', icon: '☀️' },
  { value: 'afternoon', label: 'Öğleden sonra', icon: '🌤️' },
  { value: 'evening', label: 'Akşam', icon: '🌇' },
  { value: 'night', label: 'Gece', icon: '🌙' },
];

const BUDGET_OPTIONS = ['₺400 – ₺600', '₺600 – ₺800', '₺800 – ₺1000', '₺1000+'];

const FUTURE_SUBJECT_OPTIONS_BASE = ['İspanyolca', 'Almanca', 'Fransızca', 'Arapça'];
const FUTURE_SUBJECT_OPTIONS_ALL = [...FUTURE_SUBJECT_OPTIONS_BASE, 'İtalyanca', 'Japonca', 'Rusça'];

const GOAL_MATCH_PHRASES: Record<string, string> = {
  work: 'iş hayatında özgüvenle konuşman',
  speaking: 'günlük konuşmalarında akıcı olman',
  exam: 'hedeflediğin sınavda başarılı olman',
  child: "çocuğunun İngilizce'yi keyifle öğrenmesi",
};

function recapEntries(a: Answers): string[] {
  const entries: string[] = [];
  const goalLabel = GOAL_OPTIONS.find((g) => g.value === a.goal)?.label;
  if (goalLabel) entries.push(goalLabel);
  if (a.timeline) entries.push(a.timeline);
  if (a.level) entries.push(a.level);
  entries.push(...a.teachingStyle);
  if (a.tutorCountry) {
    const c = COUNTRY_OPTIONS_ALL.find((c) => c.value === a.tutorCountry);
    if (c) entries.push(`${c.flag} ${c.label}`);
  }
  if (a.budget) entries.push(a.budget);
  entries.push(...a.days);
  return entries;
}

function Illustration({ emoji }: { emoji: string }) {
  return (
    <View style={styles.illustration}>
      <Text style={styles.illustrationEmoji}>{emoji}</Text>
    </View>
  );
}

function RadioRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.radioRow, selected && styles.radioRowActive]}>
      <Text style={styles.radioLabel}>{label}</Text>
      <View style={[styles.radioCircle, selected && styles.radioCircleActive]}>
        {selected && <View style={styles.radioDot} />}
      </View>
    </Pressable>
  );
}

function Chip({
  label,
  selected,
  onPress,
  icon,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  icon?: string;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipActive]}>
      {!!icon && <Text style={styles.chipIcon}>{icon}</Text>}
      <Text style={[styles.chipLabel, selected && styles.chipLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function RecapChip({ label, tone }: { label: string; tone: 'gold' | 'silver' }) {
  return (
    <View style={[styles.recapChip, tone === 'gold' ? styles.recapChipGold : styles.recapChipSilver]}>
      <Text style={[styles.recapChipText, tone === 'gold' && { color: colors.goldText }]}>{label}</Text>
    </View>
  );
}

export default function GoalQuiz() {
  const [stepIndex, setStepIndex] = useState(0);
  const [showAllIndustries, setShowAllIndustries] = useState(false);
  const [showAllTopics, setShowAllTopics] = useState(false);
  const [showAllCountries, setShowAllCountries] = useState(false);
  const [showAllLanguages, setShowAllLanguages] = useState(false);
  const [showAllFutureSubjects, setShowAllFutureSubjects] = useState(false);
  const [answers, setAnswers] = useState<Answers>({
    goal: null,
    timeline: null,
    industry: null,
    jobTitle: '',
    skills: [],
    topics: [],
    level: null,
    teachingStyle: [],
    tutorCountry: null,
    nativeOnly: false,
    otherLanguages: [],
    days: [],
    times: [],
    budget: null,
    futureSubjects: [],
    extraNotes: '',
  });

  const steps = useMemo(() => {
    const base: string[] = ['goal', 'timeline'];
    if (answers.goal === 'work') base.push('industry', 'jobTitle', 'skills');
    base.push(
      'topics',
      'level',
      'teachingStyle',
      'tutorCountry',
      'otherLanguages',
      'schedule',
      'budget',
      'futureSubjects',
      'extraNotes',
      'matching'
    );
    return base;
  }, [answers.goal]);

  const step = steps[stepIndex];

  function finish() {
    router.replace('/(auth)/signup-options');
  }

  function next() {
    if (stepIndex + 1 >= steps.length) {
      finish();
    } else {
      setStepIndex(stepIndex + 1);
    }
  }

  function back() {
    if (stepIndex === 0) {
      router.back();
    } else {
      setStepIndex(stepIndex - 1);
    }
  }

  function toggleMulti(
    field: 'skills' | 'topics' | 'teachingStyle' | 'otherLanguages' | 'days' | 'times' | 'futureSubjects',
    value: string,
    max?: number
  ) {
    setAnswers((prev) => {
      const list = prev[field];
      const has = list.includes(value);
      if (has) return { ...prev, [field]: list.filter((v) => v !== value) };
      if (max && list.length >= max) return prev;
      return { ...prev, [field]: [...list, value] };
    });
  }

  const canContinue =
    (step === 'goal' && !!answers.goal) ||
    (step === 'timeline' && !!answers.timeline) ||
    (step === 'industry' && !!answers.industry) ||
    (step === 'jobTitle' && true) ||
    (step === 'skills' && answers.skills.length > 0) ||
    (step === 'topics' && answers.topics.length > 0) ||
    (step === 'level' && !!answers.level) ||
    (step === 'teachingStyle' && answers.teachingStyle.length > 0) ||
    (step === 'tutorCountry' && !!answers.tutorCountry) ||
    (step === 'otherLanguages' && answers.otherLanguages.length > 0) ||
    (step === 'schedule' && answers.days.length > 0 && answers.times.length > 0) ||
    (step === 'budget' && !!answers.budget) ||
    (step === 'futureSubjects' && true) ||
    (step === 'extraNotes' && true) ||
    (step === 'matching' && true);

  return (
    <SafeAreaView style={styles.screen}>
      <Pressable onPress={back} style={styles.backBtn} hitSlop={12}>
        <Text style={styles.backArrow}>←</Text>
      </Pressable>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {step === 'goal' && (
          <>
            <Illustration emoji="🎯" />
            <Text style={styles.title}>Hedefin ne?</Text>
            <View style={styles.options}>
              {GOAL_OPTIONS.map((o) => (
                <RadioRow
                  key={o.value}
                  label={o.label}
                  selected={answers.goal === o.value}
                  onPress={() => setAnswers((prev) => ({ ...prev, goal: o.value }))}
                />
              ))}
            </View>
          </>
        )}

        {step === 'timeline' && (
          <>
            <Illustration emoji="📈" />
            <Text style={styles.title}>Bu hedefe ne zaman ulaşmak istersin?</Text>
            <View style={styles.options}>
              {TIMELINE_OPTIONS.map((o) => (
                <RadioRow
                  key={o}
                  label={o}
                  selected={answers.timeline === o}
                  onPress={() => setAnswers((prev) => ({ ...prev, timeline: o }))}
                />
              ))}
            </View>
          </>
        )}

        {step === 'industry' && (
          <>
            <Illustration emoji="💼" />
            <Text style={styles.title}>Hangi sektörde çalışıyorsun?</Text>
            <Text style={styles.subtitle}>Bu, sana en uygun öğretmeni önermemize yardımcı olur.</Text>
            <View style={styles.options}>
              {(showAllIndustries ? INDUSTRY_OPTIONS_ALL : INDUSTRY_OPTIONS_BASE).map((o) => (
                <RadioRow
                  key={o}
                  label={o}
                  selected={answers.industry === o}
                  onPress={() => setAnswers((prev) => ({ ...prev, industry: o }))}
                />
              ))}
            </View>
            {!showAllIndustries && (
              <Pressable onPress={() => setShowAllIndustries(true)} hitSlop={10}>
                <Text style={styles.link}>Tüm sektörleri göster</Text>
              </Pressable>
            )}
          </>
        )}

        {step === 'jobTitle' && (
          <>
            <Illustration emoji="🪪" />
            <Text style={styles.title}>Ünvanın veya pozisyonun ne?</Text>
            <Text style={styles.subtitle}>Birkaç kelimeyle anlat</Text>
            <TextInput
              value={answers.jobTitle}
              onChangeText={(text) => setAnswers((prev) => ({ ...prev, jobTitle: text }))}
              placeholder="Örn. Yazılım Geliştirici, Pazarlama Uzmanı..."
              placeholderTextColor={colors.faint}
              style={styles.input}
              multiline
            />
          </>
        )}

        {step === 'skills' && (
          <>
            <Illustration emoji="🚀" />
            <Text style={styles.title}>Hangi kariyer becerilerini geliştirmek istersin?</Text>
            <View style={styles.chipRow}>
              {SKILL_OPTIONS.map((o) => (
                <Chip
                  key={o}
                  label={o}
                  selected={answers.skills.includes(o)}
                  onPress={() => toggleMulti('skills', o)}
                />
              ))}
            </View>
          </>
        )}

        {step === 'topics' && (
          <>
            <Illustration emoji="📖" />
            <Text style={styles.title}>Odaklanmak istediğin başka konular var mı?</Text>
            <View style={styles.chipRow}>
              {(showAllTopics ? TOPIC_OPTIONS_ALL : TOPIC_OPTIONS_BASE).map((o) => (
                <Chip
                  key={o}
                  label={o}
                  selected={answers.topics.includes(o)}
                  onPress={() => toggleMulti('topics', o)}
                />
              ))}
            </View>
            {!showAllTopics && (
              <Pressable onPress={() => setShowAllTopics(true)} hitSlop={10} style={{ marginTop: 4 }}>
                <Text style={styles.link}>Tümünü göster</Text>
              </Pressable>
            )}
          </>
        )}

        {step === 'level' && (
          <>
            <Illustration emoji="📘" />
            <Text style={styles.title}>İngilizce seviyen nedir?</Text>
            <View style={styles.options}>
              {LEVEL_OPTIONS.map((o) => (
                <RadioRow
                  key={o}
                  label={o}
                  selected={answers.level === o}
                  onPress={() => setAnswers((prev) => ({ ...prev, level: o }))}
                />
              ))}
            </View>
          </>
        )}

        {step === 'teachingStyle' && (
          <>
            <Illustration emoji="💬" />
            <Text style={styles.title}>Senin için en iyi öğretim tarzı hangisi?</Text>
            <Text style={styles.subtitle}>
              En sevdiğin <Text style={styles.subtitleAccent}>{MAX_STYLES}</Text> özelliği seç.
            </Text>
            <View style={styles.chipRow}>
              {STYLE_OPTIONS.map((o) => (
                <Chip
                  key={o}
                  label={o}
                  selected={answers.teachingStyle.includes(o)}
                  onPress={() => toggleMulti('teachingStyle', o, MAX_STYLES)}
                />
              ))}
            </View>
          </>
        )}

        {step === 'tutorCountry' && (
          <>
            <Illustration emoji="🌍" />
            <Text style={styles.title}>Öğretmenin hangi ülkeden olmasını istersin?</Text>
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Sadece anadili İngilizce olanlar</Text>
              <Switch
                value={answers.nativeOnly}
                onValueChange={(v) => setAnswers((prev) => ({ ...prev, nativeOnly: v }))}
                trackColor={{ true: colors.gold3, false: colors.border }}
                thumbColor="#fff"
              />
            </View>
            <View style={styles.chipRow}>
              {(showAllCountries ? COUNTRY_OPTIONS_ALL : COUNTRY_OPTIONS_BASE).map((o) => (
                <Chip
                  key={o.value}
                  label={`${o.flag} ${o.label}`}
                  selected={answers.tutorCountry === o.value}
                  onPress={() => setAnswers((prev) => ({ ...prev, tutorCountry: o.value }))}
                />
              ))}
            </View>
            {!showAllCountries && (
              <Pressable onPress={() => setShowAllCountries(true)} hitSlop={10} style={{ marginTop: 4 }}>
                <Text style={styles.link}>Tümünü göster</Text>
              </Pressable>
            )}
          </>
        )}

        {step === 'otherLanguages' && (
          <>
            <Illustration emoji="🗣️" />
            <Text style={styles.title}>Öğretmeninin konuşmasını istediğin başka diller var mı?</Text>
            <View style={styles.chipRow}>
              {(showAllLanguages ? LANGUAGE_OPTIONS_ALL : LANGUAGE_OPTIONS_BASE).map((o) => (
                <Chip
                  key={o}
                  label={o}
                  selected={answers.otherLanguages.includes(o)}
                  onPress={() => toggleMulti('otherLanguages', o)}
                />
              ))}
            </View>
            {!showAllLanguages && (
              <Pressable onPress={() => setShowAllLanguages(true)} hitSlop={10} style={{ marginTop: 4 }}>
                <Text style={styles.link}>Tümünü göster</Text>
              </Pressable>
            )}
          </>
        )}

        {step === 'schedule' && (
          <>
            <Illustration emoji="🗓️" />
            <Text style={styles.title}>Ne zaman ders alabilirsin?</Text>

            <Text style={styles.sectionLabel}>Günler</Text>
            <View style={styles.chipRow}>
              {DAY_OPTIONS.map((o) => (
                <Chip key={o} label={o} selected={answers.days.includes(o)} onPress={() => toggleMulti('days', o)} />
              ))}
            </View>

            <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Saatler</Text>
            <View style={styles.chipRow}>
              {TIME_OPTIONS.map((o) => (
                <Chip
                  key={o.value}
                  icon={o.icon}
                  label={o.label}
                  selected={answers.times.includes(o.value)}
                  onPress={() => toggleMulti('times', o.value)}
                />
              ))}
            </View>
          </>
        )}

        {step === 'budget' && (
          <>
            <Illustration emoji="💰" />
            <Text style={styles.title}>Ders başına bütçen ne kadar?</Text>
            <Text style={styles.subtitle}>50 dakikalık bir ders için</Text>
            <View style={styles.options}>
              {BUDGET_OPTIONS.map((o) => (
                <RadioRow
                  key={o}
                  label={o}
                  selected={answers.budget === o}
                  onPress={() => setAnswers((prev) => ({ ...prev, budget: o }))}
                />
              ))}
            </View>
          </>
        )}

        {step === 'futureSubjects' && (
          <>
            <Illustration emoji="🧭" />
            <Text style={styles.title}>İleride başka bir dil öğrenmeyi düşünür müsün?</Text>
            <Text style={styles.subtitle}>Bu tamamen opsiyonel - şu an sadece ilgini not ediyoruz.</Text>
            <View style={styles.chipRow}>
              {(showAllFutureSubjects ? FUTURE_SUBJECT_OPTIONS_ALL : FUTURE_SUBJECT_OPTIONS_BASE).map((o) => (
                <Chip
                  key={o}
                  label={o}
                  selected={answers.futureSubjects.includes(o)}
                  onPress={() => toggleMulti('futureSubjects', o)}
                />
              ))}
            </View>
            {!showAllFutureSubjects && (
              <Pressable onPress={() => setShowAllFutureSubjects(true)} hitSlop={10} style={{ marginTop: 4 }}>
                <Text style={styles.link}>Tümünü göster</Text>
              </Pressable>
            )}
          </>
        )}

        {step === 'extraNotes' && (
          <>
            <Illustration emoji="✨" />
            <Text style={styles.title}>Sana en uygun öğretmeni bulmamıza yardımcı olacak başka bir şey var mı?</Text>
            <Text style={styles.subtitle}>Eşleşmeni daha da iyileştirmek için bunu kullanacağız.</Text>

            {recapEntries(answers).length > 0 && (
              <View style={styles.recapCard}>
                <Text style={styles.recapCardLabel}>Senden öğrendiklerimiz</Text>
                <View style={styles.recapChipRow}>
                  {recapEntries(answers).map((entry, i) => (
                    <RecapChip key={`${entry}-${i}`} label={entry} tone={i % 2 === 0 ? 'gold' : 'silver'} />
                  ))}
                </View>
              </View>
            )}

            <TextInput
              value={answers.extraNotes}
              onChangeText={(text) => setAnswers((prev) => ({ ...prev, extraNotes: text }))}
              placeholder="Örn. Öğretmenimin iş görüşmelerinde daha doğal konuşmama yardımcı olmasını istiyorum..."
              placeholderTextColor={colors.faint}
              style={styles.input}
              multiline
            />
          </>
        )}

        {step === 'matching' && (
          <View style={styles.matchingWrap}>
            <LinearGradient colors={goldGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.matchingCard}>
              <View style={styles.matchingDots}>
                <View style={styles.matchingDot} />
                <View style={[styles.matchingDot, { opacity: 0.6 }]} />
                <View style={[styles.matchingDot, { opacity: 0.3 }]} />
              </View>
              <Text style={styles.matchingEyebrow}>ARMUS SENİN İÇİN EŞLEŞTİRİYOR</Text>
              <Text style={styles.matchingTitle}>
                Sana,{' '}
                <Text style={styles.matchingAccent}>
                  {GOAL_MATCH_PHRASES[answers.goal ?? ''] ?? 'hedeflerine en uygun'}
                </Text>{' '}
                için doğru öğretmeni buluyoruz.
              </Text>
              <Text style={styles.matchingSubtitle}>500'den fazla onaylı öğretmen arasından senin için en iyisini seçiyoruz.</Text>
            </LinearGradient>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {step === 'jobTitle' && <Button label={answers.jobTitle ? 'Devam et' : 'Atla'} onPress={next} />}
        {step === 'futureSubjects' && (
          <Button label={answers.futureSubjects.length > 0 ? 'Devam et' : 'Şimdilik geç'} onPress={next} />
        )}
        {step === 'extraNotes' && <Button label="Bitir ve devam et" onPress={next} />}
        {step === 'matching' && <Button label="Devam et →" onPress={next} />}
        {step !== 'jobTitle' &&
          step !== 'futureSubjects' &&
          step !== 'extraNotes' &&
          step !== 'matching' && <Button label="Devam et" onPress={next} disabled={!canContinue} />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  backBtn: {
    marginLeft: 24,
    marginTop: 8,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  backArrow: {
    fontSize: 22,
    color: colors.ink,
  },
  content: {
    paddingBottom: 20,
  },
  illustration: {
    height: 190,
    backgroundColor: '#fff8e6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  illustrationEmoji: {
    fontSize: 72,
  },
  title: {
    fontFamily: fonts.displayBlack,
    fontSize: 26,
    lineHeight: 31,
    color: colors.ink,
    letterSpacing: -0.5,
    paddingHorizontal: 26,
    marginBottom: 10,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    paddingHorizontal: 26,
    marginBottom: 18,
    lineHeight: 20,
  },
  subtitleAccent: {
    fontFamily: fonts.bodyBold,
    color: colors.goldText,
  },
  options: {
    paddingHorizontal: 26,
    gap: 12,
    marginTop: 10,
  },
  radioRow: {
    height: 58,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  radioRowActive: {
    borderColor: colors.gold3,
    backgroundColor: '#fff8e6',
  },
  radioLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.ink,
    flexShrink: 1,
    marginRight: 12,
  },
  radioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCircleActive: {
    borderColor: colors.gold3,
  },
  radioDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: colors.gold3,
  },
  toggleRow: {
    marginHorizontal: 26,
    marginBottom: 16,
    height: 58,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14.5,
    color: colors.ink,
    flexShrink: 1,
    marginRight: 12,
  },
  link: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.goldText,
    textDecorationLine: 'underline',
    marginTop: 16,
    marginLeft: 26,
  },
  input: {
    marginHorizontal: 26,
    minHeight: 90,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: 16,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  chipRow: {
    paddingHorizontal: 26,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chipActive: {
    borderColor: colors.gold3,
    backgroundColor: '#fff8e6',
  },
  chipIcon: {
    fontSize: 15,
    marginRight: 7,
  },
  chipLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.ink,
  },
  chipLabelActive: {
    color: colors.goldText,
    fontFamily: fonts.bodyBold,
  },
  sectionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.faint,
    paddingHorizontal: 26,
    marginBottom: 12,
  },
  recapCard: {
    marginHorizontal: 26,
    marginBottom: 20,
    padding: 16,
    borderRadius: radius.lg,
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  recapCardLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 10,
  },
  recapChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  recapChip: {
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  recapChipGold: {
    backgroundColor: '#fff2cf',
  },
  recapChipSilver: {
    backgroundColor: colors.silver1,
    borderWidth: 1,
    borderColor: colors.silver2,
  },
  recapChipText: {
    fontFamily: fonts.bodySemibold,
    fontSize: 12,
    color: colors.ink,
  },
  matchingWrap: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  matchingCard: {
    borderRadius: radius.xl,
    padding: 28,
    minHeight: 380,
    justifyContent: 'center',
  },
  matchingDots: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 20,
  },
  matchingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.onGold,
  },
  matchingEyebrow: {
    fontFamily: fonts.bodyBold,
    fontSize: 11.5,
    letterSpacing: 1,
    color: colors.onGold,
    opacity: 0.7,
    marginBottom: 16,
  },
  matchingTitle: {
    fontFamily: fonts.displayBlack,
    fontSize: 30,
    lineHeight: 36,
    color: colors.onGold,
    letterSpacing: -0.8,
    marginBottom: 16,
  },
  matchingAccent: {
    color: '#fff',
  },
  matchingSubtitle: {
    fontFamily: fonts.body,
    fontSize: 14.5,
    color: colors.onGold,
    opacity: 0.75,
    lineHeight: 21,
  },
  footer: {
    paddingHorizontal: 26,
    paddingTop: 12,
    paddingBottom: 18,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
  },
});
