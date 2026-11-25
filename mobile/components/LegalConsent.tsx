import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';

import Button from './Button';
import { getLang, useT } from '../lib/i18n';
import { SITE_URL } from '../lib/referrals';
import { colors, fonts, radius } from '../lib/theme';

/**
 * The last step of signup, like the website's legal-consent.js: the
 * Kullanım Şartları and the KVKK Aydınlatma Metni, one after the other,
 * each shown from the live page on armus.com.tr (?embed=1 hides the
 * site's menus). A text's box only unlocks once the person has scrolled
 * to its end. Then the age statement, and the ticari ileti onayı as a
 * separate, optional, unticked box (KVKK Kurulu 2026/347).
 *
 * onDone gets what goes into the signup's auth metadata as `consents`;
 * handle_new_user (migration_130.sql) keeps it in user_consents.
 */

export type Consents = {
  channel: 'app';
  versions: Record<'terms' | 'kvkk_notice' | 'age_statement' | 'marketing', string>;
  terms: true;
  kvkk_notice: true;
  age_statement: true;
  marketing: boolean;
};

const AGE_STATEMENT_VERSION = '2026-11-25';

const DOCS = [
  {
    key: 'terms' as const,
    path: '/kullanim-sartlari',
    title: 'Kullanım Şartları',
    label: "Kullanım Şartları'nı okudum ve kabul ediyorum.",
  },
  {
    key: 'kvkk_notice' as const,
    path: '/kvkk-aydinlatma-metni',
    title: 'KVKK Aydınlatma Metni',
    label: "Aydınlatma Metni'ni okudum; kişisel verilerimin nasıl işleneceği konusunda bilgilendirildim.",
  },
];
const MARKETING_PATH = '/ticari-ileti-onayi';

// runs in the page: reports the text's version and how far down it is read
const PAGE_SCRIPT = `(function () {
  function post(o) { window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
  var article = document.querySelector('article.legal-doc');
  post({ type: 'doc', version: article ? article.getAttribute('data-version') : null });
  var last = -1, queued = false;
  function check() {
    queued = false;
    var el = document.scrollingElement || document.documentElement;
    var max = el.scrollHeight - window.innerHeight;
    var ratio = max <= 4 ? 1 : Math.min(1, Math.max(0, el.scrollTop / max));
    if (ratio >= 0.985 || Math.abs(ratio - last) >= 0.02) { last = ratio; post({ type: 'progress', ratio: ratio }); }
  }
  window.addEventListener('scroll', function () { if (!queued) { queued = true; requestAnimationFrame(check); } }, { passive: true });
  window.addEventListener('load', check);
  setTimeout(check, 400);
  check();
})(); true;`;

const sameDoc = (url: string, path: string) => url.split('#')[0].split('?')[0].replace(/\.html$/, '') === `${SITE_URL}${path}`;

// the version of a text, read from its page (the ticari ileti onayı is
// only linked here, not shown, but its version is still recorded)
async function fetchVersion(path: string): Promise<string | null> {
  try {
    const res = await fetch(`${SITE_URL}${path}`);
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/<article class="legal-doc"[^>]*data-version="([^"]{1,32})"/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function CheckRow({
  checked,
  disabled,
  onChange,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={() => !disabled && onChange(!checked)}
      style={styles.checkRow}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
    >
      <View style={[styles.box, checked && styles.boxChecked, disabled && styles.boxDisabled]}>
        {checked && <Text style={styles.tick}>✓</Text>}
      </View>
      <Text style={[styles.checkText, disabled && styles.checkTextDisabled]}>{children}</Text>
    </Pressable>
  );
}

export default function LegalConsent({
  visible,
  onCancel,
  onDone,
}: {
  visible: boolean;
  onCancel: () => void;
  onDone: (consents: Consents) => void;
}) {
  const t = useT();
  const insets = useSafeAreaInsets();
  // 0: Kullanım Şartları · 1: Aydınlatma Metni · 2: age + ticari ileti
  const [step, setStep] = useState(0);
  const [versions, setVersions] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [age, setAge] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const marketingVersion = useRef<string | null>(null);

  // every opening starts clean
  useEffect(() => {
    if (!visible) return;
    setStep(0);
    setVersions({});
    setProgress({});
    setAccepted({});
    setFailed(false);
    setAge(false);
    setMarketing(false);
    fetchVersion(MARKETING_PATH).then((v) => {
      marketingVersion.current = v;
    });
  }, [visible]);

  const doc = step < 2 ? DOCS[step] : null;
  const read = doc ? (progress[doc.key] ?? 0) >= 0.985 && !!versions[doc.key] : false;

  function onMessage(e: WebViewMessageEvent) {
    if (!doc) return;
    let msg: { type?: string; version?: string | null; ratio?: number };
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === 'doc') {
      if (msg.version) {
        setVersions((v) => ({ ...v, [doc.key]: String(msg.version).slice(0, 32) }));
      } else {
        // not one of our legal texts (an error page): nothing to accept
        setFailed(true);
      }
    } else if (msg.type === 'progress' && typeof msg.ratio === 'number') {
      const ratio = msg.ratio;
      // a text read to the end stays read
      setProgress((p) => ({ ...p, [doc.key]: Math.max(p[doc.key] ?? 0, ratio) }));
    }
  }

  function goNext() {
    setFailed(false);
    setStep((s) => s + 1);
  }

  function goBack() {
    if (step === 0) onCancel();
    else {
      setFailed(false);
      setStep((s) => s - 1);
    }
  }

  function finish() {
    if (!versions.terms || !versions.kvkk_notice || !accepted.terms || !accepted.kvkk_notice || !age) return;
    onDone({
      channel: 'app',
      versions: {
        terms: versions.terms,
        kvkk_notice: versions.kvkk_notice,
        age_statement: AGE_STATEMENT_VERSION,
        marketing: marketingVersion.current || AGE_STATEMENT_VERSION,
      },
      terms: true,
      kvkk_notice: true,
      age_statement: true,
      marketing,
    });
  }

  const lang = getLang();
  const ratio = doc ? progress[doc.key] ?? 0 : 1;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={goBack} presentationStyle="fullScreen">
      <View style={[styles.screen, { paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={styles.head}>
          <Text style={styles.eyebrow}>{t("SON ADIM · {0}/3", step + 1)}</Text>
          <Text style={styles.title}>{doc ? t(doc.title) : t("Son onaylar")}</Text>
          <Text style={styles.lead}>
            {doc
              ? t("Metni sonuna kadar kaydır; onay kutusu metnin sonunda açılır.")
              : t("Hesabını oluşturmadan önce son iki madde.")}</Text>
          {lang === 'en' && doc && (
            <Text style={styles.enNote}>
              {t("Bu metin Türkçe yayımlanır ve bağlayıcı olan Türkçe metindir.")}</Text>
          )}
        </View>

        {doc ? (
          <>
            <View style={styles.progress}>
              <View style={[styles.progressFill, { width: `${Math.round(ratio * 100)}%` }]} />
            </View>
            <View style={styles.webWrap}>
              {failed ? (
                <View style={styles.failBox}>
                  <Text style={styles.failText}>
                    {t("Metin yüklenemedi. İnternet bağlantını kontrol edip tekrar dene.")}</Text>
                  <Button
                    label={t("Tekrar dene")}
                    variant="outline"
                    onPress={() => {
                      setFailed(false);
                      setReloadKey((k) => k + 1);
                    }}
                  />
                </View>
              ) : (
                <WebView
                  key={`${doc.key}-${reloadKey}`}
                  source={{ uri: `${SITE_URL}${doc.path}?embed=1` }}
                  originWhitelist={['https://*']}
                  injectedJavaScriptBeforeContentLoaded={`try { localStorage.setItem('armusLang', '${lang}'); } catch (e) {} true;`}
                  injectedJavaScript={PAGE_SCRIPT}
                  onMessage={onMessage}
                  startInLoadingState
                  renderLoading={() => <ActivityIndicator color={colors.red} style={styles.loading} />}
                  onError={() => setFailed(true)}
                  onHttpError={() => setFailed(true)}
                  // the text's own links open in the browser, so the
                  // half-done signup is never lost
                  onShouldStartLoadWithRequest={(req) => {
                    if (req.isTopFrame === false || sameDoc(req.url, doc.path) || req.url === 'about:blank') return true;
                    Linking.openURL(req.url).catch(() => {});
                    return false;
                  }}
                />
              )}
            </View>
            <View style={styles.foot}>
              <CheckRow
                checked={!!accepted[doc.key]}
                disabled={!read}
                onChange={(v) => setAccepted((a) => ({ ...a, [doc.key]: v }))}
              >
                {t(doc.label)}
              </CheckRow>
              {!read && <Text style={styles.hint}>{t("Onay kutusu, metnin sonuna geldiğinde açılır.")}</Text>}
              <View style={styles.actions}>
                <View style={{ flex: 1 }}>
                  <Button label={step === 0 ? t("Vazgeç") : t("Geri")} variant="outline" onPress={goBack} />
                </View>
                <View style={{ flex: 1.4 }}>
                  <Button label={t("Devam")} onPress={goNext} disabled={!accepted[doc.key]} />
                </View>
              </View>
            </View>
          </>
        ) : (
          <>
            <ScrollView style={styles.finalList} contentContainerStyle={styles.finalContent}>
              <View style={styles.done}>
                <Text style={styles.doneText}>✓ {t("Kullanım Şartları")}</Text>
                <Text style={styles.doneText}>✓ {t("KVKK Aydınlatma Metni")}</Text>
              </View>
              <View style={styles.card}>
                <CheckRow checked={age} onChange={setAge}>
                  {t("18 yaşını doldurdum. 18 yaşından küçüksem, bu hesabı velimin veya yasal temsilcimin bilgisi ve onayıyla oluşturuyorum.")}
                </CheckRow>
              </View>
              <Text style={styles.optional}>{t("İSTEĞE BAĞLI")}</Text>
              <View style={styles.card}>
                <CheckRow checked={marketing} onChange={setMarketing}>
                  {t("Kampanya, indirim ve yeniliklerden e-posta ile haberdar olmak istiyorum.")}{' '}
                  <Text style={styles.link} onPress={() => Linking.openURL(`${SITE_URL}${MARKETING_PATH}`)}>
                    {t("Ticari Elektronik İleti ve Açık Rıza Onay Metni")}</Text>
                  {'. '}
                  {t("Bu onay isteğe bağlıdır; vermesen de tüm hizmetleri kullanabilirsin ve dilediğin zaman geri alabilirsin.")}
                </CheckRow>
              </View>
            </ScrollView>
            <View style={styles.foot}>
              <View style={styles.actions}>
                <View style={{ flex: 1 }}>
                  <Button label={t("Geri")} variant="outline" onPress={goBack} />
                </View>
                <View style={{ flex: 1.4 }}>
                  <Button label={t("Hesabı oluştur")} onPress={finish} disabled={!age} />
                </View>
              </View>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  head: { paddingHorizontal: 22, paddingBottom: 12 },
  eyebrow: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.6, color: colors.goldText },
  title: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28, color: colors.ink, letterSpacing: -0.4, marginTop: 6 },
  lead: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.muted, marginTop: 6 },
  enNote: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.muted,
    backgroundColor: colors.panel2,
    borderRadius: radius.sm,
    padding: 10,
    marginTop: 10,
  },
  progress: { height: 4, backgroundColor: colors.borderSoft },
  progressFill: { height: 4, backgroundColor: colors.red },
  webWrap: { flex: 1, backgroundColor: colors.panel },
  loading: { position: 'absolute', top: 40, left: 0, right: 0 },
  failBox: { flex: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 16 },
  failText: { fontFamily: fonts.bodyMedium, fontSize: 14, lineHeight: 20, color: colors.error, textAlign: 'center' },
  foot: { paddingHorizontal: 22, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.faint, marginTop: -4, marginBottom: 10, marginLeft: 32 },
  actions: { flexDirection: 'row', gap: 10 },
  checkRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginBottom: 12 },
  box: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  boxChecked: { backgroundColor: colors.red, borderColor: colors.red },
  boxDisabled: { backgroundColor: colors.panel2, borderColor: colors.borderSoft },
  tick: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.onRed },
  checkText: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink },
  checkTextDisabled: { color: colors.faint },
  finalList: { flex: 1 },
  finalContent: { paddingHorizontal: 22, paddingBottom: 24, gap: 12 },
  done: { backgroundColor: colors.petrolSoft, borderRadius: radius.md, padding: 14, gap: 6 },
  doneText: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: colors.petrol },
  card: { backgroundColor: colors.panel, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 14, paddingBottom: 2 },
  optional: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.2, color: colors.muted, marginTop: 4 },
  link: { fontFamily: fonts.bodySemibold, color: colors.goldText, textDecorationLine: 'underline' },
});
