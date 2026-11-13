import { useState } from 'react';

import Button from '../../components/Button';
import FormScreen, { Field, FormMessage } from '../../components/FormScreen';
import { supabase } from '../../lib/supabase';

/** Şifre değiştir: same rules as the website's settings (at least 6 characters, typed twice). */
export default function PasswordSettings() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  async function save() {
    if (password.length < 6) {
      setMessage({ text: 'Şifre en az 6 karakter olmalı.', error: true });
      return;
    }
    if (password !== confirm) {
      setMessage({ text: 'Şifreler eşleşmiyor.', error: true });
      return;
    }
    setSaving(true);
    setMessage(null);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      setMessage({ text: error.message || 'Kaydedilemedi. Lütfen tekrar dene.', error: true });
      return;
    }
    setPassword('');
    setConfirm('');
    setMessage({ text: 'Şifren güncellendi.' });
  }

  return (
    <FormScreen title="Şifre değiştir">
      <Field label="Yeni şifre" value={password} onChangeText={setPassword} placeholder="En az 6 karakter" secureTextEntry autoComplete="new-password" />
      <Field label="Yeni şifre (tekrar)" value={confirm} onChangeText={setConfirm} placeholder="Şifreni tekrar yaz" secureTextEntry autoComplete="new-password" />
      {message && <FormMessage text={message.text} error={message.error} />}
      <Button label="Şifreyi kaydet" onPress={save} loading={saving} />
    </FormScreen>
  );
}
