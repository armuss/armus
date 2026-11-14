import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScrollBand } from '../../components/Band';
import Button from '../../components/Button';
import { useAuth } from '../../lib/auth';
import { PHOTO_NEEDS_WHITE_BG, preparePhoto, STUDENT_PHOTO_MAX_BYTES } from '../../lib/photo';
import { updateOwnProfile, uploadProfilePhoto } from '../../lib/profile';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius } from '../../lib/theme';
import { useT } from '../../lib/i18n';

const PENDING_FIELDS = ['title', 'price', 'availability', 'bio'] as const;

const NAME_PATTERN = /^\p{L}+(?:['-]\p{L}+)*(?:\s+\p{L}+(?:['-]\p{L}+)*)+$/u;

export default function EditProfile() {
  const t = useT();
  const { profile, refreshProfile } = useAuth();

  const [loading, setLoading] = useState(true);
  // the red band reaches just past the photo
  const [photoBottom, setPhotoBottom] = useState(220);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  // the picked photo, already turned into the JPEG that gets uploaded
  const [localPhoto, setLocalPhoto] = useState<{ uri: string; base64: string } | null>(null);
  const localPhotoUri = localPhoto?.uri ?? null;
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [checkingPhoto, setCheckingPhoto] = useState(false);
  // an approved teacher's photo is part of their checked application: the
  // database refuses a direct change (application_locked), like the site
  const [photoLocked, setPhotoLocked] = useState(false);

  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [availability, setAvailability] = useState('');
  const [bio, setBio] = useState('');
  const [pendingChanges, setPendingChanges] = useState<Record<string, unknown> | null>(null);

  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [teacherStatus, setTeacherStatus] = useState('');

  const isTeacher = profile?.role === 'teacher';

  useEffect(() => {
    if (!profile) return;
    supabase
      .from('profiles')
      .select('*')
      .eq('id', profile.id)
      .single()
      .then(({ data }) => {
        if (!data) {
          setLoading(false);
          return;
        }
        setName(data.name || '');
        setCity(data.city || '');
        setPhotoUrl(data.photo_url || null);
        setPhotoLocked(data.role === 'teacher' && data.status === 'approved');

        const pending = data.pending_changes || null;
        setPendingChanges(pending);
        setTitle(pending?.title ?? data.title ?? '');
        setPrice(String(pending?.price ?? data.price ?? ''));
        setAvailability(pending?.availability ?? data.availability ?? '');
        setBio(pending?.bio ?? data.bio ?? '');
        setLoading(false);
      });
  }, [profile]);

  // the website's photo rules (lib/photo.ts): a teacher's photo needs a
  // plain white background and is re-encoded like the site does; a
  // student's may be at most 5MB
  async function pickPhoto() {
    setStatus('');
    if (photoLocked) {
      setStatus(t("Onaylı öğretmenler profil fotoğrafını buradan değiştiremez. Fotoğrafını güncellemek için bize ulaş."));
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setStatus(t("Fotoğraf seçmek için galeri izni gerekiyor."));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      // a teacher's photo keeps its own framing (the site doesn't crop it);
      // a student's avatar is cropped square
      allowsEditing: !isTeacher,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];

    if (!isTeacher && asset.fileSize && asset.fileSize > STUDENT_PHOTO_MAX_BYTES) {
      setStatus(t("Dosya çok büyük (maks 5MB)."));
      return;
    }

    // every photo becomes a JPEG of at most 1024px before upload (the
    // bucket takes JPEG/PNG only); a teacher's also needs the white background
    setCheckingPhoto(true);
    try {
      const prepared = await preparePhoto(asset.uri, isTeacher);
      if (!prepared.isWhiteBackground) {
        setStatus(t(PHOTO_NEEDS_WHITE_BG));
        return;
      }
      setLocalPhoto({ uri: prepared.uri, base64: prepared.base64 });
    } catch {
      setStatus(t("Fotoğraf okunamadı."));
    } finally {
      setCheckingPhoto(false);
    }
  }

  async function handleSave() {
    if (!profile || saving) return;
    setStatus('');
    // the same rule as signup and the website's settings: a first and a
    // last name, not a single word or a nickname
    if (!NAME_PATTERN.test(name.trim())) {
      setStatus(t("Lütfen adını ve soyadını yaz (tek bir kelime yeterli değil)."));
      return;
    }
    setSaving(true);

    let nextPhotoUrl = photoUrl;
    if (localPhoto) {
      setUploadingPhoto(true);
      const uploaded = await uploadProfilePhoto(profile.id, localPhoto.base64);
      setUploadingPhoto(false);
      if (!uploaded) {
        setSaving(false);
        setStatus(t("Fotoğraf yüklenemedi, tekrar dene."));
        return;
      }
      nextPhotoUrl = uploaded;
    }

    const ok = await updateOwnProfile({ name: name.trim(), city: city.trim() || null, photo_url: nextPhotoUrl });
    setSaving(false);

    if (!ok) {
      setStatus(t("Kaydedilemedi, tekrar dene."));
      return;
    }

    await refreshProfile();
    router.back();
  }

  async function handleSubmitTeacherFields() {
    if (!profile || saving) return;
    setSaving(true);
    setTeacherStatus('');

    const newPendingChanges = {
      ...(pendingChanges || {}),
      title: title.trim(),
      price: Number(price) || 0,
      availability: availability.trim(),
      bio: bio.trim(),
    };

    const ok = await updateOwnProfile({ pending_changes: newPendingChanges });
    setSaving(false);
    setTeacherStatus(ok ? t("Onay için gönderildi ✓") : t("Gönderilemedi ✕"));
    if (ok) setPendingChanges(newPendingChanges);
  }

  const hasPendingTeacherFields = PENDING_FIELDS.some((key) => pendingChanges && pendingChanges[key] !== undefined);

  if (loading) {
    return (
      <SafeAreaView style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={colors.red} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeRed} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView style={styles.list} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ScrollBand height={photoBottom - 10} inset={24} fade={70} />
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>{t("← Geri")}</Text>
          </Pressable>

          <Text style={styles.screenTitle}>{t("Profili Düzenle")}</Text>

          <Pressable
            onPress={pickPhoto}
            style={styles.photoWrap}
            onLayout={(e) => setPhotoBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}
          >
            {localPhotoUri || photoUrl ? (
              <Image source={{ uri: localPhotoUri || photoUrl! }} style={styles.photo} />
            ) : (
              <View style={[styles.photo, styles.photoFallback]}>
                <Text style={styles.photoFallbackText}>{(name[0] || '?').toUpperCase()}</Text>
              </View>
            )}
            <Text style={styles.photoEditText}>
              {checkingPhoto
                ? t("Fotoğraf kontrol ediliyor…")
                : photoLocked
                  ? t("Fotoğraf değişikliği için bize ulaş")
                  : t("Fotoğrafı değiştir")}
            </Text>
            {isTeacher && !photoLocked && <Text style={styles.photoRule}>{t("Arka plan düz beyaz olmalı")}</Text>}
          </Pressable>

          <View style={styles.field}>
            <Text style={styles.label}>{t("Ad Soyad")}</Text>
            <TextInput value={name} onChangeText={setName} style={styles.input} placeholderTextColor={colors.faint} />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t("Şehir")}</Text>
            <TextInput
              value={city}
              onChangeText={setCity}
              placeholder={t("İstanbul")}
              placeholderTextColor={colors.faint}
              style={styles.input}
            />
          </View>

          {!!status && <Text style={styles.error}>{status}</Text>}

          <Button
            label={uploadingPhoto ? t("Fotoğraf yükleniyor…") : t("Kaydet")}
            onPress={handleSave}
            loading={saving}
          />

          {isTeacher && (
            <View style={styles.teacherSection}>
              <Text style={styles.sectionTitle}>{t("Öğretmen profili")}</Text>
              <Text style={styles.sectionNote}>
                {t("Bu alanlardaki değişiklikler ARMUS ekibinin onayından sonra yayına girer.")}</Text>

              {hasPendingTeacherFields && <Text style={styles.pendingNote}>{t("İncelemede bekleyen bir değişikliğin var.")}</Text>}

              <View style={styles.field}>
                <Text style={styles.label}>{t("Ünvan")}</Text>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder={t("IELTS & Speaking Uzmanı")}
                  placeholderTextColor={colors.faint}
                  style={styles.input}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>{t("Ders ücreti (₺)")}</Text>
                <TextInput
                  value={price}
                  onChangeText={setPrice}
                  keyboardType="number-pad"
                  style={styles.input}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>{t("Müsaitlik notu")}</Text>
                <TextInput
                  value={availability}
                  onChangeText={setAvailability}
                  placeholder={t("Şu anda ders almaya uygun")}
                  placeholderTextColor={colors.faint}
                  style={styles.input}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>{t("Hakkında")}</Text>
                <TextInput
                  value={bio}
                  onChangeText={setBio}
                  multiline
                  style={[styles.input, styles.textArea]}
                  placeholderTextColor={colors.faint}
                />
              </View>

              {!!teacherStatus && <Text style={styles.pendingNote}>{teacherStatus}</Text>}

              <Button label={t("Onaya Gönder")} variant="outline" onPress={handleSubmitTeacherFields} loading={saving} />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  // the status bar area is plain red; the scroll view paints the ground and carries the band
  safeRed: { flex: 1, backgroundColor: colors.red },
  list: { flex: 1, backgroundColor: colors.bg },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 40,
  },
  backBtn: {
    marginBottom: 12,
  },
  backText: {
    fontFamily: fonts.bodySemibold,
    fontSize: 13.5,
    color: 'rgba(250,245,226,0.85)',
  },
  screenTitle: {
    fontFamily: fonts.display,
    fontSize: 24,
    color: colors.onRed,
    letterSpacing: -0.5,
    marginBottom: 20,
  },
  photoWrap: {
    alignItems: 'center',
    marginBottom: 24,
  },
  photo: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 3,
    borderColor: colors.cream,
    backgroundColor: colors.champagne,
  },
  photoFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoFallbackText: {
    fontFamily: fonts.display,
    fontSize: 32,
    color: colors.red,
  },
  photoRule: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11.5,
    color: 'rgba(250,245,226,0.8)',
    marginTop: 2,
  },
  photoEditText: {
    fontFamily: fonts.bodyBold,
    fontSize: 12.5,
    color: colors.onRed,
    marginTop: 10,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    fontFamily: fonts.bodySemibold,
    fontSize: 12.5,
    color: colors.ink,
    marginBottom: 8,
  },
  input: {
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: 14,
    fontFamily: fonts.body,
    fontSize: 14.5,
    color: colors.ink,
    backgroundColor: colors.panel,
  },
  textArea: {
    height: 100,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  error: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12.5,
    color: colors.error,
    marginBottom: 12,
  },
  teacherSection: {
    marginTop: 32,
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
  },
  sectionTitle: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 16,
    color: colors.ink,
    marginBottom: 6,
  },
  sectionNote: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.muted,
    lineHeight: 18,
    marginBottom: 14,
  },
  pendingNote: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12.5,
    color: colors.goldText,
    backgroundColor: colors.goldPale,
    borderRadius: radius.md,
    padding: 10,
    marginBottom: 14,
  },
});
