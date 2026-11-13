import { useState } from 'react';

import Button from '../../components/Button';
import FormScreen, { Field, FormMessage } from '../../components/FormScreen';
import { supabase } from '../../lib/supabase';
import { useT } from '../../lib/i18n';

/** Şifre değiştir: same rules as the website's settings (at least 6 characters, typed twice). */
export default function PasswordSettings() {
  const t = useT();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  async function save() {
    if (password.length < 6) {
      setMessage({ text: t("Şifre en az 6 karakter olmalı."), error: true });
      return;
    }
    if (password !== confirm) {
      setMessage({ text: t("Şifreler eşleşmiyor."), error: true });
      return;
    }
    setSaving(true);
    setMessage(null);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      setMessage({ text: error.message || t("Kaydedilemedi. Lütfen tekrar dene."), error: true });
      return;
    }
    setPassword('');
    setConfirm('');
    setMessage({ text: t("Şifren güncellendi.") });
  }

  return (
    <FormScreen title={t("Şifre değiştir")}>
      <Field label={t("Yeni şifre")} value={password} onChangeText={setPassword} placeholder={t("En az 6 karakter")} secureTextEntry autoComplete="new-password" />
      <Field label={t("Yeni şifre (tekrar)")} value={confirm} onChangeText={setConfirm} placeholder={t("Şifreni tekrar yaz")} secureTextEntry autoComplete="new-password" />
      {message && <FormMessage text={message.text} error={message.error} />}
      <Button label={t("Şifreyi kaydet")} onPress={save} loading={saving} />
    </FormScreen>
  );
}
