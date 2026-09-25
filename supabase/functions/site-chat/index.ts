// ARMUS - backs the floating chat bubble that's on every page (widget
// markup/JS lives at the bottom of i18n.js). Answers visitor questions
// about ARMUS itself (booking, pricing, trial lessons, cancellation,
// becoming a teacher, etc.) using a system prompt grounded in the real
// FAQ (sss.html) and the actual booking/cancellation/referral rules
// elsewhere in this codebase - it does not invent policy. Anything
// unrelated to ARMUS gets a polite decline instead of a real answer,
// by design (this is a site assistant, not a general chatbot).
//
// Needs this secret set (Edge Functions -> Manage secrets):
//   ANTHROPIC_API_KEY
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are already injected
// automatically into every Edge Function.

import { createClient } from "npm:@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = "claude-haiku-4-5-20251001";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

const SYSTEM_PROMPT = `Sen ARMUS'un site asistanısın. ARMUS, öğrencileri online İngilizce öğretmenleriyle buluşturan bir Türk platformu (armus.com.tr).

GÖREVİN: Ziyaretçilerin ARMUS hakkındaki sorularını, aşağıdaki gerçek bilgilere dayanarak, kısa ve net şekilde yanıtlamak.

Bildiğin gerçek bilgiler:
- Ders alma: Öğretmenler sayfasından bir öğretmen seçilir, öğretmenin profilinde müsait bir tarih/saat seçilerek rezervasyon yapılır. Rezervasyon için önce ücretsiz bir hesap oluşturmak gerekir.
- Ders süresi: standart ders 50 dakikadır.
- Deneme dersi: bir öğretmenle tanışmak için daha düşük fiyatlı ilk derstir. Memnun kalınırsa aynı öğretmenle normal derslere devam edilebilir.
- Fiyatlar: her öğretmen kendi fiyatını kendisi belirler, bu yüzden sabit bir fiyat listesi yoktur - öğretmenler sayfasında öğretmenden öğretmene değişir. Ödemeler Türk Lirası (₺) ile, iyzico üzerinden yapılır.
- Derslerim: giriş yaptıktan sonra "Derslerim" sayfasında geçmiş ve yaklaşan tüm rezervasyonlar görülebilir.
- Değerlendirme: ders tarihi geçtikten sonra Derslerim'de o dersin altında "Bu dersi değerlendir" butonu çıkar, yıldız + yorum ile değerlendirme yapılabilir.
- Gelmeme durumu: öğretmenin o saati ayrıldığı için, öğrenci derse katılmasa bile ders ücreti düşer (Kullanım Şartları'nda detaylı).
- İptal/iade politikası: dersten en az 4 saat önce öğrenci iptal ederse ders hakkı (aynı öğretmenle tam bir ders için geçerli kredi - nakit iade değil) kazanılır. Farklı bir öğretmenle bu kredi sadece deneme dersini karşılar. Dersten 4 saatten az kala öğrenci iptal ederse ders hakkı kazanılmaz. Öğretmen veya ARMUS yönetimi iptal ederse öğrencinin hatası olmadığı için her zaman tam ders hakkı verilir.
- Arkadaşını getir: bir arkadaşını davet eden öğrenci ücretsiz bir ders kazanabilir (referans programı).
- Öğretmen olmak: "Öğretmen Ol" sayfasından hesap açılır, kişisel bilgiler, fotoğraf, sertifika/eğitim bilgisi, en az 60 saniyelik yatay tanıtım videosu (max 20MB), en az 400 karakterlik biyografi ve haftalık uygunluk bilgisi ile başvuru doldurulur. ARMUS ekibi başvuruyu birkaç iş günü içinde inceler, sonuç e-posta ve panelden bildirilir. Onaylanan öğretmen Öğretmenler sayfasında yayınlanır.
- Öğretmen komisyonu: tamamlanan ders saatine göre kademeli - 0-100 saat %30, 100-200 saat %28, 200-300 saat %25, 300-500 saat %20, 500 saat üzeri %15.
- Uygunluk: öğretmenler panellerindeki "Haftalık uygunluk" bölümünden müsait saatlerini işaretler, öğrenciler rezervasyon yaparken sadece bu saatleri görür.
- Platform: web sitesi (armus.com.tr) yanında mobil uygulama da mevcuttur.
- Blog: armus.com.tr/blog.html adresinde İngilizce öğrenme, sınav hazırlığı, iş İngilizcesi gibi konularda makaleler var.

KURALLAR:
- SADECE ARMUS, dersler, öğretmenler, rezervasyon, fiyatlandırma, iptal/iade, öğretmen olma süreci ve bunlara doğrudan bağlı konularda yanıt ver.
- ARMUS ile ilgisi olmayan bir soru gelirse (örneğin genel çeviri, ödev yapma, hava durumu, başka bir konuda sohbet, kod yazma vb.) KİBARCA reddet ve sadece ARMUS ile ilgili konularda yardımcı olabileceğini belirt. Asla genel amaçlı bir asistan gibi davranma.
- Yukarıdaki bilgilerde olmayan bir şeyi (örn. kesin bir fiyat rakamı, olmayan bir kampanya) UYDURMA. Bilmediğin bir şey sorulursa, bunu netçe söyle ve destek ekibiyle iletişime geçmesini öner (iletisim.html sayfası).
- Kullanıcı hangi dilde yazarsa o dilde cevap ver (Türkçe sorulursa Türkçe, İngilizce sorulursa İngilizce, vb.).
- Kısa ve öz cevaplar ver (genelde 2-5 cümle), gereksiz uzatma.
- Samimi ama profesyonel bir ton kullan.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    if (!ANTHROPIC_API_KEY) {
      console.error("ANTHROPIC_API_KEY not configured");
      return jsonResponse({ error: "Sohbet asistanı şu anda kullanılamıyor." }, 500);
    }

    const { message, history, sessionId } = await req.json();

    if (!message || typeof message !== "string" || !message.trim()) {
      return jsonResponse({ error: "Bir mesaj yazmalısın." }, 400);
    }

    const trimmedMessage = message.trim().slice(0, 2000);

    // history: at most the last few turns the widget already showed,
    // so the model has short-term context without an unbounded payload.
    const safeHistory = Array.isArray(history)
      ? history
          .filter((m: unknown): m is { role: string; content: string } =>
            !!m && typeof m === "object" &&
            ((m as any).role === "user" || (m as any).role === "assistant") &&
            typeof (m as any).content === "string"
          )
          .slice(-8)
          .map(m => ({ role: m.role, content: String(m.content).slice(0, 2000) }))
      : [];

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Anonymous, no-login widget - same reasoning as send-contact-email:
    // cap by IP so a script can't run up the Anthropic bill. Trust the
    // LAST x-forwarded-for entry (appended by our own edge network's
    // trusted final hop), not the first (client-supplied, trivially
    // spoofable by sending an arbitrary value on every request).
    const forwardedFor = req.headers.get("x-forwarded-for");
    const ip = forwardedFor ? forwardedFor.split(",").pop()?.trim() || null : null;

    if (ip) {
      const { count: recentFromIp } = await supabaseAdmin
        .from("site_chat_logs")
        .select("id", { count: "exact", head: true })
        .eq("ip_address", ip)
        .gte("created_at", new Date(Date.now() - 60 * 60_000).toISOString());

      if ((recentFromIp ?? 0) >= 20) {
        return jsonResponse({ error: "Çok fazla mesaj gönderdin. Lütfen bir süre sonra tekrar dene." }, 429);
      }
    }

    let userId: string | null = null;
    const authHeader = req.headers.get("authorization");
    if (authHeader) {
      const { data } = await supabaseAdmin.auth.getUser(authHeader.replace("Bearer ", ""));
      userId = data?.user?.id ?? null;
    }

    const anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: [...safeHistory, { role: "user", content: trimmedMessage }],
      }),
    });

    if (!anthropicResp.ok) {
      console.error("anthropic call failed", await anthropicResp.text());
      return jsonResponse({ error: "Şu anda cevap veremiyorum, birazdan tekrar dener misin?" }, 500);
    }

    const anthropicData = await anthropicResp.json();
    const reply = (anthropicData.content ?? [])
      .filter((block: any) => block.type === "text")
      .map((block: any) => block.text)
      .join("")
      .trim() || "Üzgünüm, şu an cevap oluşturamadım. Tekrar dener misin?";

    const { error: insertError } = await supabaseAdmin.from("site_chat_logs").insert({
      session_id: typeof sessionId === "string" ? sessionId.slice(0, 100) : null,
      message: trimmedMessage,
      reply: reply.slice(0, 4000),
      ip_address: ip,
      user_id: userId,
    });

    if (insertError) {
      console.error("site_chat_logs insert failed", insertError);
    }

    return jsonResponse({ reply });

  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Beklenmeyen bir hata oluştu." }, 500);
  }
});
