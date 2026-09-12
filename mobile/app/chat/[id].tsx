import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../lib/auth';
import {
  getMessages,
  hasBookingWithOtherParty,
  markMessagesRead,
  messageViolatesContactPolicy,
  sendMessage,
  subscribeToMessages,
  type Message,
} from '../../lib/messages';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius } from '../../lib/theme';

export default function Chat() {
  const { id, otherName, otherPhoto } = useLocalSearchParams<{
    id: string;
    otherName?: string;
    otherPhoto?: string;
  }>();
  const { profile } = useAuth();

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [canShareContact, setCanShareContact] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);

  useEffect(() => {
    if (!profile) return;

    let active = true;
    getMessages(id).then((data) => {
      if (!active) return;
      setMessages(data);
      setLoading(false);
      markMessagesRead(id, profile.id);
    });

    const channel = subscribeToMessages(id, (message) => {
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      if (message.senderId !== profile.id) markMessagesRead(id, profile.id);
    });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, profile?.id]);

  // Figure out the other participant once we know the conversation, so we
  // can check whether contact info is allowed (a real booking together).
  useEffect(() => {
    if (!profile) return;

    supabase
      .from('conversations')
      .select('*')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        const otherId = data.student_id === profile.id ? data.teacher_id : data.student_id;
        hasBookingWithOtherParty(profile.id, profile.role, otherId).then(setCanShareContact);
      });
  }, [id, profile]);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  useEffect(() => {
    if (messages.length) scrollToEnd();
  }, [messages.length, scrollToEnd]);

  async function handleSend() {
    const body = text.trim();
    if (!body || !profile || sending) return;

    if (!canShareContact && messageViolatesContactPolicy(body)) {
      setWarning(
        'Bu mesaj gönderilemedi: telefon numarası, e-posta veya WhatsApp/Instagram gibi platform dışı iletişim bilgisi paylaşımı, resmi bir ders rezervasyonu olana kadar yasak. Lütfen yazışmaya ARMUS üzerinden devam et.'
      );
      return;
    }

    setWarning(null);
    setText('');
    setSending(true);
    const result = await sendMessage(id, profile.id, body);
    setSending(false);

    if (result === 'blocked') {
      setText(body);
      setWarning('Bu mesaj gönderilemedi: platform dışı iletişim bilgisi paylaşımı henüz yasak.');
      return;
    }
    if (!result) {
      setText(body);
      setWarning('Mesaj gönderilemedi. Tekrar dene.');
      return;
    }
    setMessages((prev) => (prev.some((m) => m.id === result.id) ? prev : [...prev, result]));
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </Pressable>
        {otherPhoto ? (
          <Image source={{ uri: otherPhoto }} style={styles.headerAvatar} />
        ) : (
          <View style={[styles.headerAvatar, styles.headerAvatarFallback]}>
            <Text style={styles.headerAvatarInitial}>{(otherName?.[0] || '?').toUpperCase()}</Text>
          </View>
        )}
        <Text style={styles.headerName} numberOfLines={1}>
          {otherName || 'Kullanıcı'}
        </Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {loading ? (
          <ActivityIndicator color={colors.gold3} style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            onContentSizeChange={scrollToEnd}
            renderItem={({ item }) => {
              const isMine = item.senderId === profile?.id;
              return (
                <View style={[styles.row, isMine && styles.rowMine]}>
                  <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>{item.body}</Text>
                  </View>
                </View>
              );
            }}
            ListEmptyComponent={
              <Text style={styles.empty}>Henüz mesaj yok, ilk mesajı sen gönder.</Text>
            }
          />
        )}

        {warning && <Text style={styles.warning}>{warning}</Text>}

        <View style={styles.inputRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Mesaj yaz..."
            placeholderTextColor={colors.faint}
            style={styles.input}
            multiline
          />
          <Pressable
            onPress={handleSend}
            disabled={!text.trim() || sending}
            style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnDisabled]}
          >
            <Text style={styles.sendBtnText}>Gönder</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  backBtn: {
    paddingRight: 4,
  },
  backText: {
    fontSize: 20,
    color: colors.ink,
  },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.panel2,
  },
  headerAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarInitial: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.ink,
  },
  headerName: {
    flex: 1,
    fontFamily: fonts.bodyExtraBold,
    fontSize: 16,
    color: colors.ink,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexGrow: 1,
  },
  row: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  rowMine: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '78%',
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleTheirs: {
    backgroundColor: colors.panel2,
    borderBottomLeftRadius: 4,
  },
  bubbleMine: {
    backgroundColor: colors.gold3,
    borderBottomRightRadius: 4,
  },
  bubbleText: {
    fontFamily: fonts.body,
    fontSize: 14.5,
    color: colors.ink,
    lineHeight: 20,
  },
  bubbleTextMine: {
    color: colors.onGold,
  },
  empty: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 40,
  },
  warning: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.goldText,
    backgroundColor: '#fff8e6',
    borderRadius: radius.md,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    backgroundColor: colors.panel,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: fonts.body,
    fontSize: 14.5,
    color: colors.ink,
  },
  sendBtn: {
    height: 44,
    borderRadius: radius.lg,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold3,
  },
  sendBtnDisabled: {
    opacity: 0.5,
  },
  sendBtnText: {
    fontFamily: fonts.bodyBold,
    fontSize: 13.5,
    color: colors.onGold,
  },
});
