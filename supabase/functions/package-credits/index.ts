// ARMUS - what a student can do with package lessons whose teacher can't
// teach them anymore (migration_110.sql's stranded_package_credits: the
// teacher is banned, is blocking this student, or is no longer an
// approved teacher). Called from my-lessons.html.
//
// Actions (body.action):
//   "refund"   { teacher_id }
//     The unused lessons' share of the package price goes back to the card
//     the package was paid with - an iyzico refund on that payment's
//     transaction, one per package payment. A lesson whose payment can't
//     be found (packages from before migration_110.sql that couldn't be
//     matched) isn't touched; the student is pointed to support for it.
//   "transfer" { teacher_id, new_teacher_id }
//     The unused lessons move to another teacher, each still worth what
//     was paid for it (transferred_at): a dearer lesson with the new
//     teacher is topped up by card, a cheaper one is covered -
//     create-payment's creditCoverage.
//
// Deploy: Supabase Dashboard -> Edge Functions -> Deploy a new function,
// name it "package-credits", paste this file, Deploy. Leave "Verify JWT"
// ON - the site calls it with the signed-in user's token.
//
// Needs the same iyzico secrets as create-payment (IYZICO_API_KEY,
// IYZICO_SECRET_KEY, optionally IYZICO_BASE_URL), plus RESEND_API_KEY,
// EMAIL_FROM, SITE_URL for the confirmation email.

import Iyzipay from "npm:iyzipay@^2.0.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const iyzipay = new Iyzipay({
  apiKey: Deno.env.get("IYZICO_API_KEY") ?? "",
  secretKey: Deno.env.get("IYZICO_SECRET_KEY") ?? "",
  uri: Deno.env.get("IYZICO_BASE_URL") ?? "https://sandbox-api.iyzipay.com",
});

const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://armus.com.tr").replace(/\/$/, "");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("EMAIL_FROM") ?? "ARMUS <onboarding@resend.dev>";

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

function isUuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function escapeHtml(str: string) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// a teacher's full name is never shown to a student anywhere - same
// policy as the other emails (see auth.js armusShortDisplayName)
function shortDisplayName(fullName: string) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || "Öğretmen";
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

function money(amount: number) {
  return `₺${Number(amount).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`;
}

function emailHtml(recipientName: string, text: string) {
  return `
  <div style="background:#0d0d0f;padding:40px 20px;font-family:Arial,sans-serif;">
    <div style="max-width:440px;margin:0 auto;background:#1a1712;border:1px solid #2e2a22;border-radius:16px;padding:32px;text-align:center;">
      <div style="font-size:22px;font-weight:800;letter-spacing:-1px;background:linear-gradient(90deg,#e8c777,#b8860b);-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:24px;">ARMUS</div>
      <p style="color:#f4f4f2;font-size:14px;margin:0 0 6px;">Merhaba ${escapeHtml(recipientName)},</p>
      <p style="color:#a3a3a6;font-size:13px;line-height:1.6;margin:0 0 22px;">${escapeHtml(text)}</p>
      <a href="${SITE_URL}/my-lessons.html" style="display:inline-block;background:linear-gradient(90deg,#e8c777,#b8860b);color:#1c1c1e;font-size:14px;font-weight:700;padding:13px 26px;border-radius:12px;text-decoration:none;">Derslerimi Gör</a>
    </div>
  </div>`;
}

async function sendEmail(to: string, subject: string, html: string) {
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
    });
    if (!resp.ok) console.error("resend send failed", to, await resp.text());
  } catch (err) {
    console.error("resend send threw", to, err);
  }
}

function iyzicoRefund(request: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    iyzipay.refund.create(request, (err: unknown, res: unknown) => {
      if (err) reject(err); else resolve(res);
    });
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Giriş yapmalısın." }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return jsonResponse({ error: "Giriş yapmalısın." }, 401);

    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const teacherId = typeof body.teacher_id === "string" ? body.teacher_id : "";
    if (!teacherId) return jsonResponse({ error: "teacher_id gerekli." }, 400);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: stranded, error: strandedError } = await supabaseAdmin
      .rpc("stranded_package_credits", { p_student_id: user.id, p_teacher_id: teacherId });
    if (strandedError) {
      console.error("stranded_package_credits failed", strandedError);
      return jsonResponse({ error: "Beklenmeyen bir hata oluştu." }, 500);
    }
    if (!stranded || !stranded.length) {
      return jsonResponse({ error: "Bu öğretmenle iade edilebilecek ya da aktarılabilecek paket dersin yok." }, 400);
    }

    const { data: studentProfile } = await supabaseAdmin
      .from("profiles")
      .select("email, name")
      .eq("id", user.id)
      .maybeSingle();
    const oldTeacherShort = shortDisplayName(stranded[0].teacher_name);

    if (action === "refund") {

      // one refund per package payment
      const groups = new Map<string, any[]>();
      let notRefundable = 0;
      for (const c of stranded) {
        if (!c.pending_payment_id || c.value === null || c.value === undefined) { notRefundable++; continue; }
        groups.set(c.pending_payment_id, [...(groups.get(c.pending_payment_id) || []), c]);
      }

      const { data: payments } = groups.size
        ? await supabaseAdmin
            .from("pending_payments")
            .select("id, price, refunded_amount, iyzico_payment_transaction_id, status, type")
            .in("id", [...groups.keys()])
        : { data: [] };
      const paymentById = new Map((payments || []).map((p: any) => [p.id, p]));

      let refundedLessons = 0;
      let refundedAmount = 0;
      let failed = 0;
      const ip = req.headers.get("x-forwarded-for")?.split(",").pop()?.trim() || "85.34.78.112";

      for (const [paymentId, credits] of groups) {
        const payment = paymentById.get(paymentId);
        if (!payment?.iyzico_payment_transaction_id || payment.type !== "package" || payment.status !== "succeeded") {
          notRefundable += credits.length;
          continue;
        }

        // claim first, so two clicks can't refund the same lessons twice
        const { data: claimed } = await supabaseAdmin
          .from("lesson_credits")
          .update({ status: "refunded", refunded_at: new Date().toISOString() })
          .in("id", credits.map((c) => c.id))
          .eq("status", "available")
          .select("id, value");
        if (!claimed || !claimed.length) continue;

        const amount = Math.round(claimed.reduce((sum: number, c: any) => sum + Number(c.value), 0) * 100) / 100;
        const stillRefundable = Number(payment.price) - Number(payment.refunded_amount || 0);
        const putBack = async () => {
          await supabaseAdmin
            .from("lesson_credits")
            .update({ status: "available", refunded_at: null })
            .in("id", claimed.map((c: any) => c.id))
            .eq("status", "refunded");
        };
        if (amount <= 0 || amount > stillRefundable + 0.01) {
          await putBack();
          notRefundable += claimed.length;
          continue;
        }

        let result: any = null;
        try {
          result = await iyzicoRefund({
            locale: Iyzipay.LOCALE.TR,
            conversationId: crypto.randomUUID(),
            paymentTransactionId: payment.iyzico_payment_transaction_id,
            price: amount.toFixed(2),
            currency: Iyzipay.CURRENCY.TRY,
            ip,
          });
        } catch (err) {
          console.error("iyzico refund threw", paymentId, err);
        }

        if (result?.status !== "success") {
          console.error("iyzico refund failed", paymentId, result);
          await putBack();
          failed += claimed.length;
          continue;
        }

        await supabaseAdmin
          .from("pending_payments")
          .update({ refunded_amount: Number(payment.refunded_amount || 0) + amount })
          .eq("id", paymentId);
        refundedLessons += claimed.length;
        refundedAmount += amount;
      }

      refundedAmount = Math.round(refundedAmount * 100) / 100;

      if (refundedLessons > 0 && studentProfile?.email) {
        await sendEmail(
          studentProfile.email,
          "Paket iaden yapıldı - ARMUS",
          emailHtml(
            studentProfile.name,
            `${oldTeacherShort} ile paketinden kalan ${refundedLessons} dersin ücreti (${money(refundedAmount)}) ödeme yaptığın karta iade edildi. Tutarın hesabına geçmesi bankana göre birkaç iş günü sürebilir.`,
          ),
        );
      }

      if (refundedLessons === 0) {
        return jsonResponse({
          error: failed
            ? "İade şu anda yapılamadı. Lütfen biraz sonra tekrar dene."
            : "Bu dersler otomatik iade edilemiyor. Lütfen destek ekibimize yaz, iadeni biz yapalım.",
          failed, notRefundable,
        }, failed ? 502 : 400);
      }

      return jsonResponse({ ok: true, refundedLessons, refundedAmount, notRefundable, failed });
    }

    if (action === "transfer") {

      const newTeacherId = body.new_teacher_id;
      if (!isUuid(newTeacherId) || newTeacherId === teacherId) {
        return jsonResponse({ error: "Geçerli bir öğretmen seç." }, 400);
      }

      // same checks create-payment makes before taking a booking with them
      const { data: newTeacher } = await supabaseAdmin
        .from("profiles")
        .select("id, name, status, price, is_banned, hidden_until, hidden_from_new_students")
        .eq("id", newTeacherId)
        .maybeSingle();
      const hiddenUntilStillActive = newTeacher?.hidden_until && new Date(newTeacher.hidden_until) > new Date();
      if (!newTeacher || newTeacher.status !== "approved" || newTeacher.is_banned || hiddenUntilStillActive || !(Number(newTeacher.price) > 0)) {
        return jsonResponse({ error: "Bu öğretmen şu anda ders vermiyor. Başka bir öğretmen seç." }, 400);
      }
      if (newTeacher.hidden_from_new_students) {
        const { count: priorBookingCount } = await supabaseAdmin
          .from("bookings")
          .select("id", { count: "exact", head: true })
          .eq("student_id", user.id)
          .eq("teacher_id", newTeacherId);
        if (!priorBookingCount) {
          return jsonResponse({ error: "Bu öğretmen şu anda ders vermiyor. Başka bir öğretmen seç." }, 400);
        }
      }
      const { data: block } = await supabaseAdmin
        .from("blocked_students")
        .select("id")
        .eq("teacher_id", newTeacherId)
        .eq("student_id", user.id)
        .maybeSingle();
      if (block) {
        return jsonResponse({ error: "Bu öğretmen şu anda ders vermiyor. Başka bir öğretmen seç." }, 400);
      }

      const { data: moved } = await supabaseAdmin
        .from("lesson_credits")
        .update({ teacher_id: newTeacherId, teacher_name: newTeacher.name, transferred_at: new Date().toISOString() })
        .in("id", stranded.map((c: any) => c.id))
        .eq("status", "available")
        .select("id, value");

      const transferred = (moved || []).length;
      if (!transferred) {
        return jsonResponse({ error: "Bu öğretmenle aktarılabilecek paket dersin yok." }, 400);
      }

      if (studentProfile?.email) {
        await sendEmail(
          studentProfile.email,
          "Paketin aktarıldı - ARMUS",
          emailHtml(
            studentProfile.name,
            `${oldTeacherShort} ile paketinden kalan ${transferred} ders ${shortDisplayName(newTeacher.name)} ile kullanılabilir. Her ders, paketin için ödediğin tutar kadar değerinde: yeni öğretmeninin ders ücreti daha yüksekse aradaki farkı rezervasyon sırasında kartla ödersin.`,
          ),
        );
      }

      return jsonResponse({ ok: true, transferred, teacherName: shortDisplayName(newTeacher.name), teacherPrice: Number(newTeacher.price) });
    }

    return jsonResponse({ error: "Geçersiz işlem." }, 400);

  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Beklenmeyen bir hata oluştu." }, 500);
  }
});
