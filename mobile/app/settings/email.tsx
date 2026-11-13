import { useState } from 'react';

import Button from '../../components/Button';
import FormScreen, { Field, FormMessage } from '../../components/FormScreen';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';

/** E-posta: same as the website's settings - Supabase mails a confirmation link to the new address. */
export default function EmailSettings() {
  const { profile } = useAuth();
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  async function save() {
    const next = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
      setMessage({ text: 'Lütfen geçerli bir e-posta adresi yaz.', error: true });
      return;
    }
    setSaving(true);
    setMessage(null);
    const { error } = await supabase.auth.updateUser({ email: next });
    setSaving(false);
    if (error) {
      setMessage({ text: error.message || 'Kaydedilemedi. Lütfen tekrar dene.', error: true });
      return;
    }
    setEmail('');
    setMessage({ text: 'Onay e-postası gönderildi. Değişikliği tamamlamak için gelen kutunu kontrol et.' });
  }

  return (
    <FormScreen title="E-posta" intro="Yeni adresine bir onay bağlantısı göndeririz; bağlantıya tıklayınca e-postan değişir.">
      <Field label="Şu anki e-posta" value={profile?.email ?? ''} editable={false} />
      <Field
        label="Yeni e-posta"
        value={email}
        onChangeText={setEmail}
        placeholder="ornek@eposta.com"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
      />
      {message && <FormMessage text={message.text} error={message.error} />}
      <Button label="Onay e-postası gönder" onPress={save} loading={saving} />
    </FormScreen>
  );
}
