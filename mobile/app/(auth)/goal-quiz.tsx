import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Button from '../../components/Button';
import { colors, fonts, radius } from '../../lib/theme';

type Answers = {
  goal: string | null;
  timeline: string | null;
  industry: string | null;
  jobTitle: string;
  skills: string[];
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

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipActive]}>
      <Text style={[styles.chipLabel, selected && styles.chipLabelActive]}>{label}</Text>
    </Pressable>
  );
}

export default function GoalQuiz() {
  const [stepIndex, setStepIndex] = useState(0);
  const [showAllIndustries, setShowAllIndustries] = useState(false);
  const [answers, setAnswers] = useState<Answers>({
    goal: null,
    timeline: null,
    industry: null,
    jobTitle: '',
    skills: [],
  });

  const steps = useMemo(() => {
    const base: string[] = ['goal', 'timeline'];
    if (answers.goal === 'work') base.push('industry', 'jobTitle', 'skills');
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

  function toggleSkill(skill: string) {
    setAnswers((prev) => {
      const has = prev.skills.includes(skill);
      return { ...prev, skills: has ? prev.skills.filter((s) => s !== skill) : [...prev.skills, skill] };
    });
  }

  const canContinue =
    (step === 'goal' && !!answers.goal) ||
    (step === 'timeline' && !!answers.timeline) ||
    (step === 'industry' && !!answers.industry) ||
    (step === 'jobTitle' && true) ||
    (step === 'skills' && answers.skills.length > 0);

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
                <Chip key={o} label={o} selected={answers.skills.includes(o)} onPress={() => toggleSkill(o)} />
              ))}
            </View>
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {step === 'jobTitle' ? (
          <Button label={answers.jobTitle ? 'Devam et' : 'Atla'} onPress={next} />
        ) : (
          <Button label="Devam et" onPress={next} disabled={!canContinue} />
        )}
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
  },
  chipActive: {
    borderColor: colors.gold3,
    backgroundColor: '#fff8e6',
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
  footer: {
    paddingHorizontal: 26,
    paddingTop: 12,
    paddingBottom: 18,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
  },
});
