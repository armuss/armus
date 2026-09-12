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

import Button from '../../components/Button';
import { useAuth } from '../../lib/auth';
import { updateOwnProfile, uploadProfilePhoto } from '../../lib/profile';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius } from '../../lib/theme';

const PENDING_FIELDS = ['title', 'price', 'availability', 'bio'] as const;

export default function EditProfile() {
  const { profile, refreshProfile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [localPhotoUri, setLocalPhotoUri] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

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

        const pending = data.pending_changes || null;
        setPendingChanges(pending);
        setTitle(pending?.title ?? data.title ?? '');
        setPrice(String(pending?.price ?? data.price ?? ''));
        setAvailability(pending?.availability ?? data.availability ?? '');
        setBio(pending?.bio ?? data.bio ?? '');
        setLoading(false);
      });
  }, [profile]);

  async function pickPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setStatus('Fotoğraf seçmek için galeri izni gerekiyor.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;

    setLocalPhotoUri(result.assets[0].uri);
  }

  async function handleSave() {
    if (!profile || saving) return;
    setSaving(true);
    setStatus('');

    let nextPhotoUrl = photoUrl;
    if (localPhotoUri) {
      setUploadingPhoto(true);
      const uploaded = await uploadProfilePhoto(profile.id, localPhotoUri);
      setUploadingPhoto(false);
      if (!uploaded) {
        setSaving(false);
        setStatus('Fotoğraf yüklenemedi, tekrar dene.');
        return;
      }
      nextPhotoUrl = uploaded;
    }

    const ok = await updateOwnProfile({ name: name.trim(), city: city.trim() || null, photo_url: nextPhotoUrl });
    setSaving(false);

    if (!ok) {
      setStatus('Kaydedilemedi, tekrar dene.');
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
    setTeacherStatus(ok ? 'Onay için gönderildi ✓' : 'Gönderilemedi ✕');
    if (ok) setPendingChanges(newPendingChanges);
  }

  const hasPendingTeacherFields = PENDING_FIELDS.some((key) => pendingChanges && pendingChanges[key] !== undefined);

  if (loading) {
    return (
      <SafeAreaView style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={colors.gold3} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>← Geri</Text>
          </Pressable>

          <Text style={styles.screenTitle}>Profili Düzenle</Text>

          <Pressable onPress={pickPhoto} style={styles.photoWrap}>
            {localPhotoUri || photoUrl ? (
              <Image source={{ uri: localPhotoUri || photoUrl! }} style={styles.photo} />
            ) : (
              <View style={[styles.photo, styles.photoFallback]}>
                <Text style={styles.photoFallbackText}>{(name[0] || '?').toUpperCase()}</Text>
              </View>
            )}
            <Text style={styles.photoEditText}>Fotoğrafı değiştir</Text>
          </Pressable>

          <View style={styles.field}>
            <Text style={styles.label}>Ad Soyad</Text>
            <TextInput value={name} onChangeText={setName} style={styles.input} placeholderTextColor={colors.faint} />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Şehir</Text>
            <TextInput
              value={city}
              onChangeText={setCity}
              placeholder="İstanbul"
              placeholderTextColor={colors.faint}
              style={styles.input}
            />
          </View>

          {!!status && <Text style={styles.error}>{status}</Text>}

          <Button
            label={uploadingPhoto ? 'Fotoğraf yükleniyor…' : 'Kaydet'}
            onPress={handleSave}
            loading={saving}
          />

          {isTeacher && (
            <View style={styles.teacherSection}>
              <Text style={styles.sectionTitle}>Öğretmen profili</Text>
              <Text style={styles.sectionNote}>
                Bu alanlardaki değişiklikler ARMUS ekibinin onayından sonra yayına girer.
              </Text>

              {hasPendingTeacherFields && <Text style={styles.pendingNote}>İncelemede bekleyen bir değişikliğin var.</Text>}

              <View style={styles.field}>
                <Text style={styles.label}>Ünvan</Text>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder="IELTS & Speaking Uzmanı"
                  placeholderTextColor={colors.faint}
                  style={styles.input}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Ders ücreti (₺)</Text>
                <TextInput
                  value={price}
                  onChangeText={setPrice}
                  keyboardType="number-pad"
                  style={styles.input}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Müsaitlik notu</Text>
                <TextInput
                  value={availability}
                  onChangeText={setAvailability}
                  placeholder="Şu anda ders almaya uygun"
                  placeholderTextColor={colors.faint}
                  style={styles.input}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Hakkında</Text>
                <TextInput
                  value={bio}
                  onChangeText={setBio}
                  multiline
                  style={[styles.input, styles.textArea]}
                  placeholderTextColor={colors.faint}
                />
              </View>

              {!!teacherStatus && <Text style={styles.pendingNote}>{teacherStatus}</Text>}

              <Button label="Onaya Gönder" variant="outline" onPress={handleSubmitTeacherFields} loading={saving} />
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
    color: colors.muted,
  },
  screenTitle: {
    fontFamily: fonts.display,
    fontSize: 24,
    color: colors.ink,
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
    backgroundColor: colors.panel2,
  },
  photoFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoFallbackText: {
    fontFamily: fonts.display,
    fontSize: 32,
    color: colors.ink,
  },
  photoEditText: {
    fontFamily: fonts.bodyBold,
    fontSize: 12.5,
    color: colors.goldText,
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
    backgroundColor: '#fff8e6',
    borderRadius: radius.md,
    padding: 10,
    marginBottom: 14,
  },
});
