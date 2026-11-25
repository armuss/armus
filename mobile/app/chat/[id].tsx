import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLightStatusBar } from '../../components/Band';
import { amIBlockedBy, getBlockedStudents } from '../../lib/blocks';
import { useAuth } from '../../lib/auth';
import { confirmAsync } from '../../lib/dialogs';
import {
  attachmentPreviewLabel,
  canDeleteMessage,
  canEditMessage,
  deleteMessage,
  editMessage,
  getMessages,
  hasBookingWithOtherParty,
  markMessagesRead,
  messageViolatesContactPolicy,
  sendMessage,
  subscribeToMessages,
  type Message,
} from '../../lib/messages';
import { supabase } from '../../lib/supabase';
import { capitalizeName } from '../../lib/displayName';
import { colors, fonts, radius } from '../../lib/theme';
import { getLocale, useT } from '../../lib/i18n';

// "14 Kas 15:30" under each message, like mesajlar.html's formatTime
function formatMessageTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(getLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const OWN_STORAGE = 'https://rwdxubadjbwdsmrmgmkr.supabase.co/storage/v1/object/public/';

export default function Chat() {
  const t = useT();
  const params = useLocalSearchParams<{
    id: string;
    otherName?: string;
    otherPhoto?: string;
  }>();
  const { id } = params;
  const { profile } = useAuth();
  // The name/photo in the link only fill the header until the conversation
  // itself is read - an armus://chat/<id>?otherName=ARMUS%20Destek link
  // made up by someone else would otherwise show any name and picture over
  // their own messages. A photo from the link is only shown when it's a
  // file of ARMUS's own storage (where every profile photo is).
  const [other, setOther] = useState<{ name?: string; photo?: string }>(() => ({
    name: typeof params.otherName === 'string' ? params.otherName : undefined,
    photo: typeof params.otherPhoto === 'string' && params.otherPhoto.startsWith(OWN_STORAGE) ? params.otherPhoto : undefined,
  }));
  const otherName = other.name;
  const otherPhoto = other.photo;

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const loadRef = useRef<() => void>(() => {});
  const insets = useSafeAreaInsets();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [canShareContact, setCanShareContact] = useState(false);
  // a teacher who blocked this student (teacher-blocks.js): no new messages
  const [blockedByTeacher, setBlockedByTeacher] = useState(false);
  // the message being edited in the box below (long-press -> Düzenle)
  const [editingId, setEditingId] = useState<string | null>(null);
  const isAdmin = !!profile?.is_admin;
  const listRef = useRef<FlatList<Message>>(null);
  useLightStatusBar();

  useEffect(() => {
    if (!profile) return;

    let active = true;
    const myId = profile.id;

    function load() {
      getMessages(id).then((data) => {
        if (!active) return;
        setLoading(false);
        if (data === null) {
          // what is already on screen stays; an empty screen says it failed
          // (it used to look like a conversation with no messages)
          setLoadError(true);
          return;
        }
        setLoadError(false);
        // a message that came in live while this was loading stays
        setMessages((prev) => {
          const ids = new Set(data.map((m) => m.id));
          const last = data.length ? data[data.length - 1].createdAt : '';
          return [...data, ...prev.filter((m) => !ids.has(m.id) && m.createdAt > last)];
        });
        markMessagesRead(id, myId);
      });
    }
    loadRef.current = () => {
      setLoading(true);
      load();
    };
    load();

    const channel = subscribeToMessages(
      id,
      (message) => {
        setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
        if (message.senderId !== myId) markMessagesRead(id, myId);
      },
      (message) => setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m))),
      // an admin's message removed for good
      (messageId) => setMessages((prev) => prev.filter((m) => m.id !== messageId))
    );

    // the live connection drops while the app is in the background, and
    // whatever arrived meanwhile never showed up in the open chat - read
    // the conversation again when the app comes back
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') load();
    });

    return () => {
      active = false;
      appState.remove();
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, profile?.id]);

  // the message box sits above the iPhone's home indicator, and right on
  // top of the keyboard while it's open
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, () => setKeyboardOpen(true));
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  function goBack() {
    // opened from a notification with nothing under it: back goes to Messages
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/messages');
  }

  // Figure out the other participant once we know the conversation, so we
  // can check whether contact info is allowed (a real booking together).
  useEffect(() => {
    if (!profile) return;

    supabase
      .from('conversations')
      .select('*')
      .eq('id', id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!data) {
          // not one of this user's conversations: nothing from the link stays
          if (!error) setOther({});
          return;
        }
        const otherId = data.student_id === profile.id ? data.teacher_id : data.student_id;
        // the other side as the database shows them (a teacher's name
        // already short, "Ayşe Y.") - not as the link says
        supabase
          .from('masked_profiles')
          .select('name, photo_url')
          .eq('id', otherId)
          .maybeSingle()
          .then(({ data: person }) => {
            if (!person) return;
            setOther({
              name: person.name || undefined,
              photo: typeof person.photo_url === 'string' && /^https:\/\//i.test(person.photo_url) ? person.photo_url : undefined,
            });
          });
        hasBookingWithOtherParty(profile.id, profile.role, otherId).then(setCanShareContact);
        if (profile.role === 'student') {
          amIBlockedBy(otherId).then((isBlocked) => {
            setBlockedByTeacher(isBlocked);
            if (isBlocked) setWarning(t("Bu öğretmen seni engelledi. Artık ona mesaj gönderemez ya da onunla yeni bir ders rezervasyonu yapamazsın."));
          });
        } else {
          // the teacher's own block stops their messages too (is_pair_blocked
          // in messages_insert_own) - say so instead of "try again"
          getBlockedStudents(profile.id).then((blockedIds) => {
            if (!blockedIds.has(otherId)) return;
            setBlockedByTeacher(true);
            setWarning(t("Bu öğrenciyi engelledin. Ona mesaj göndermek için önce engelini kaldır."));
          });
        }
      });
  }, [id, profile]);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  useEffect(() => {
    if (messages.length) scrollToEnd();
  }, [messages.length, scrollToEnd]);

  // long-press on your own message: edit (15 minutes; an admin any
  // time) or delete
  function openMessageActions(item: Message) {
    const editable = canEditMessage(item, profile?.id, isAdmin);
    const deletable = canDeleteMessage(item, profile?.id);
    if (!editable && !deletable) return;
    if (Platform.OS === 'web') {
      if (deletable) handleDelete(item);
      return;
    }
    Alert.alert(
      t("Mesaj"),
      undefined,
      [
        ...(editable ? [{ text: t("Düzenle"), onPress: () => startEdit(item) }] : []),
        // the confirmation is a second alert: let this one close first
        ...(deletable ? [{ text: t("Sil"), style: 'destructive' as const, onPress: () => setTimeout(() => handleDelete(item), 300) }] : []),
        { text: t("Vazgeç"), style: 'cancel' as const },
      ],
      { cancelable: true }
    );
  }

  function startEdit(item: Message) {
    setWarning(null);
    setEditingId(item.id);
    setText(item.body);
  }

  function cancelEdit() {
    setEditingId(null);
    setText('');
  }

  async function handleDelete(item: Message) {
    const ok = await confirmAsync(
      t("Bu mesaj silinsin mi?"),
      isAdmin
        ? t("Mesaj karşı taraftan da tamamen kaldırılır.")
        : t("Karşı taraf yerinde “Bu mesaj silindi” görür."),
      t("Sil"),
      true
    );
    if (!ok) return;
    const result = await deleteMessage(item.id);
    if (!result) {
      setWarning(t("Mesaj silinemedi."));
      return;
    }
    if (editingId === item.id) cancelEdit();
    if (result === 'removed') {
      const rest = messages.filter((m) => m.id !== item.id);
      setMessages(rest);
      // it was the only message: the conversation is gone too
      if (!rest.length) goBack();
      return;
    }
    setMessages((prev) =>
      prev.map((m) =>
        m.id === item.id ? { ...m, body: '', attachmentUrl: null, attachmentType: null, deletedAt: new Date().toISOString() } : m
      )
    );
  }

  async function saveEdit(messageId: string, body: string) {
    if (!canShareContact && messageViolatesContactPolicy(body)) {
      setWarning(t("Bu mesaj gönderilemedi: platform dışı iletişim bilgisi paylaşımı henüz yasak."));
      return;
    }
    setSending(true);
    const result = await editMessage(messageId, body);
    setSending(false);
    if (result && typeof result === 'object') {
      setMessages((prev) => prev.map((m) => (m.id === result.id ? result : m)));
      cancelEdit();
      setWarning(null);
      return;
    }
    if (result === 'expired') {
      cancelEdit();
      setWarning(t("Bu mesajı düzenleme süresi doldu (gönderildikten sonraki 15 dakika içinde düzenlenebilir)."));
      return;
    }
    if (result === 'deleted') cancelEdit();
    setWarning(t("Mesaj düzenlenemedi."));
  }

  async function handleSend() {
    const body = text.trim();
    if (!body || !profile || sending || blockedByTeacher) return;

    if (editingId) {
      await saveEdit(editingId, body);
      return;
    }

    if (!canShareContact && messageViolatesContactPolicy(body)) {
      setWarning(
        t("Bu mesaj gönderilemedi: telefon numarası, e-posta veya WhatsApp/Instagram gibi platform dışı iletişim bilgisi paylaşımı, resmi bir ders rezervasyonu olana kadar yasak. Lütfen yazışmaya ARMUS üzerinden devam et.")
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
      setWarning(t("Bu mesaj gönderilemedi: platform dışı iletişim bilgisi paylaşımı henüz yasak."));
      return;
    }
    if (!result) {
      setText(body);
      setWarning(t("Mesaj gönderilemedi. Tekrar dene."));
      return;
    }
    setMessages((prev) => (prev.some((m) => m.id === result.id) ? prev : [...prev, result]));
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={goBack} style={styles.backBtn} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("Geri")}>
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
          {capitalizeName(otherName) || t("Kullanıcı")}
        </Text>
      </View>

      {/* no keyboardVerticalOffset: this view's own layout already starts
          below the header (its parent sits at the top of the screen), and
          the extra 90 left a blank band between the keyboard and the
          message box on iPhone. 'padding' on Android too: an edge-to-edge
          Android app isn't resized for the keyboard any more, so the
          message box ended up under it; where the window is still
          resized, the view no longer overlaps the keyboard and nothing
          is added. */}
      <KeyboardAvoidingView style={styles.body} behavior="padding">
        {loading && !messages.length ? (
          <ActivityIndicator color={colors.red} style={{ marginTop: 40 }} />
        ) : loadError && !messages.length ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{t("Mesajlar yüklenemedi. İnternet bağlantını kontrol edip tekrar dene.")}</Text>
            <Pressable onPress={() => loadRef.current()} style={styles.retryBtn} accessibilityRole="button">
              <Text style={styles.retryText}>{t("Tekrar dene")}</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            extraData={t}
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            onContentSizeChange={scrollToEnd}
            renderItem={({ item }) => {
              const isMine = item.senderId === profile?.id;
              if (item.deletedAt) {
                return (
                  <View style={[styles.row, isMine && styles.rowMine]}>
                    <View style={[styles.bubble, styles.bubbleDeleted]}>
                      <Text style={styles.deletedText}>
                        🚫 {isMine ? t("Bu mesajı sildin") : t("Bu mesaj silindi")}
                      </Text>
                      <Text style={styles.time}>{formatMessageTime(item.createdAt)}</Text>
                    </View>
                  </View>
                );
              }
              const hasActions = canEditMessage(item, profile?.id, isAdmin) || canDeleteMessage(item, profile?.id);
              return (
                <View style={[styles.row, isMine && styles.rowMine]}>
                  <Pressable
                    onLongPress={hasActions ? () => openMessageActions(item) : undefined}
                    delayLongPress={350}
                    disabled={!hasActions}
                    accessibilityHint={hasActions ? t("Düzenlemek veya silmek için basılı tut") : undefined}
                    style={({ pressed }) => [styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs, pressed && hasActions && { opacity: 0.8 }, editingId === item.id && styles.bubbleEditing]}
                  >
                    {/* a photo / video / voice message sent from the website:
                        the photo shows here, the others open in the browser */}
                    {item.attachmentUrl && item.attachmentType === 'image' && (
                      <Pressable onPress={() => Linking.openURL(item.attachmentUrl!).catch(() => {})} accessibilityLabel={attachmentPreviewLabel('image')}>
                        <Image source={{ uri: item.attachmentUrl }} style={styles.attachmentImage} resizeMode="cover" />
                      </Pressable>
                    )}
                    {item.attachmentUrl && item.attachmentType !== 'image' && (
                      <Pressable onPress={() => Linking.openURL(item.attachmentUrl!).catch(() => {})} hitSlop={6}>
                        <Text style={[styles.bubbleText, styles.attachmentLink, isMine && styles.bubbleTextMine]}>
                          {attachmentPreviewLabel(item.attachmentType)}
                        </Text>
                      </Pressable>
                    )}
                    {!!item.body && (
                      <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine, !!item.attachmentUrl && { marginTop: 6 }]}>{item.body}</Text>
                    )}
                    {/* when it was sent - the website shows this on every message */}
                    <Text style={[styles.time, isMine && styles.timeMine]}>
                      {formatMessageTime(item.createdAt)}
                      {item.editedAt ? ` ${t("(düzenlendi)")}` : ''}
                    </Text>
                  </Pressable>
                </View>
              );
            }}
            ListEmptyComponent={
              <Text style={styles.empty}>{t("Henüz mesaj yok, ilk mesajı sen gönder.")}</Text>
            }
          />
        )}

        {warning && <Text style={styles.warning}>{warning}</Text>}

        {editingId && (
          <View style={styles.editBar}>
            <Text style={styles.editBarText}>{t("Mesajı düzenliyorsun")}</Text>
            <Pressable onPress={cancelEdit} hitSlop={8} accessibilityRole="button">
              <Text style={styles.editBarCancel}>{t("Vazgeç")}</Text>
            </Pressable>
          </View>
        )}

        <View style={[styles.inputRow, { paddingBottom: keyboardOpen ? 10 : Math.max(14, insets.bottom + 6) }]}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t("Mesaj yaz...")}
            placeholderTextColor={colors.faint}
            style={styles.input}
            multiline
            editable={!blockedByTeacher}
          />
          <Pressable
            onPress={handleSend}
            disabled={!text.trim() || sending || blockedByTeacher}
            style={[styles.sendBtn, (!text.trim() || sending || blockedByTeacher) && styles.sendBtnDisabled]}
          >
            <Text style={styles.sendBtnText}>{editingId ? t("Kaydet") : t("Gönder")}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // the status bar and the header are red (design A); the conversation sits on the ground
  screen: {
    flex: 1,
    backgroundColor: colors.red,
  },
  body: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    paddingRight: 4,
  },
  backText: {
    fontSize: 20,
    color: colors.onRed,
  },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.cream,
    backgroundColor: colors.champagne,
  },
  headerAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarInitial: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.red,
  },
  headerName: {
    flex: 1,
    fontFamily: fonts.bodyExtraBold,
    fontSize: 16,
    color: colors.onRed,
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
  // their messages white, mine red with cream text
  bubbleTheirs: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 4,
  },
  bubbleMine: {
    backgroundColor: colors.dark,
    borderBottomRightRadius: 4,
  },
  bubbleText: {
    fontFamily: fonts.body,
    fontSize: 14.5,
    color: colors.ink,
    lineHeight: 20,
  },
  bubbleTextMine: {
    color: colors.onRed,
  },
  // deleted by its sender: an outline where the bubble was
  bubbleDeleted: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
  deletedText: {
    fontFamily: fonts.body,
    fontStyle: 'italic',
    fontSize: 13.5,
    color: colors.muted,
  },
  bubbleEditing: {
    borderWidth: 2,
    borderColor: colors.goldDot,
  },
  editBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.goldPale,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
  },
  editBarText: {
    fontFamily: fonts.bodySemibold,
    fontSize: 13,
    color: colors.ink,
  },
  editBarCancel: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.goldText,
  },
  attachmentImage: {
    width: 200,
    height: 200,
    borderRadius: radius.md,
    backgroundColor: colors.panel2,
  },
  attachmentLink: {
    fontFamily: fonts.bodyBold,
    textDecorationLine: 'underline',
  },
  time: {
    fontFamily: fonts.body,
    fontSize: 10.5,
    color: colors.faint,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  timeMine: {
    color: 'rgba(250,245,226,0.6)',
  },
  errorBox: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingTop: 48,
    gap: 14,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
    textAlign: 'center',
  },
  retryBtn: {
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.dark,
  },
  retryText: {
    fontFamily: fonts.bodyBold,
    fontSize: 13.5,
    color: colors.onRed,
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
    backgroundColor: colors.goldPale,
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
    borderRadius: 22,
    backgroundColor: colors.panel2,
    paddingHorizontal: 16,
    paddingVertical: 11,
    fontFamily: fonts.body,
    fontSize: 14.5,
    color: colors.ink,
  },
  sendBtn: {
    height: 44,
    borderRadius: 22,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.dark,
  },
  sendBtnDisabled: {
    opacity: 0.5,
  },
  sendBtnText: {
    fontFamily: fonts.bodyBold,
    fontSize: 13.5,
    color: colors.onRed,
  },
});
