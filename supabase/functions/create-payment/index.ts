// ARMUS - starts an iyzico Checkout Form payment for a booking, first
// checking whether an available lesson credit (see migration_28.sql,
// granted by cancel-booking) covers it for free.
//
// Called from booking.html (armusSupabase.functions.invoke("create-payment", ...))
// right when the student clicks "Onayla". Two outcomes:
//   - an available credit covers this booking (same teacher as the
//     credit, or any teacher if this is a trial lesson): the booking is
//     created directly, right here, with no iyzico step at all and no
//     charge - response is { bookedDirectly: true, creditApplied: true }
//   - no matching credit: unchanged, full price charged to the card
// Either way nothing is written to the real "bookings" table for a card
// payment - a pending_payments row is created instead, and the booking
// itself is only created by payment-callback once iyzico confirms the
// charge actually succeeded. This is what stops a student from getting a
// lesson slot without paying (or a slot being held forever for a payment
// that never completes). A credit-covered booking deliberately gets no
// pending_payments row at all - that's what stops a student from farming
// free lessons by cancelling a credit-covered booking to get another
// credit (cancel-booking only grants one when there's a real payment on
// file for the booking being cancelled).
//
// (The wallet feature - balance/top-up applied at checkout - is on hold
// for now, see ARMUS_WALLET_ENABLED in auth.js; it's not used here.)
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function,
// name it "create-payment", paste this file in, Deploy.
//
// Needs these secrets set (Edge Functions -> Manage secrets):
//   IYZICO_API_KEY, IYZICO_SECRET_KEY
// Optional:
//   IYZICO_BASE_URL (defaults to the iyzico sandbox - switch to
//     https://api.iyzipay.com once you have a real production merchant
//     account and want to take real payments)
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are
// already injected automatically into every Edge Function - no need to
// set those yourself.

import Iyzipay from "npm:iyzipay@^2.0.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const iyzipay = new Iyzipay({
  apiKey: Deno.env.get("IYZICO_API_KEY") ?? "",
  secretKey: Deno.env.get("IYZICO_SECRET_KEY") ?? "",
  uri: Deno.env.get("IYZICO_BASE_URL") ?? "https://sandbox-api.iyzipay.com",
});

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

// a plain "11111111111"-style placeholder is never valid - real Turkish
// identity numbers can't start with 0, and this is the one loose format
// check worth doing before sending it on to iyzico
function looksLikeIdentityNumber(value: string) {
  return /^[1-9][0-9]{10}$/.test(value);
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

    const { data: profile } = await supabase
      .from("profiles")
      .select("name, email, city")
      .eq("id", user.id)
      .single();

    if (!profile) return jsonResponse({ error: "Profil bulunamadı." }, 400);

    const body = await req.json().catch(() => ({}));
    const { teacherId, teacherName, type, date, time, price, phone, identityNumber } = body;

    if (!teacherId || !teacherName || !type || !date || !time || !price) {
      return jsonResponse({ error: "Eksik rezervasyon bilgisi." }, 400);
    }
    if (type !== "trial" && type !== "lesson") {
      return jsonResponse({ error: "Geçersiz ders tipi." }, 400);
    }

    const numericPrice = Number(price);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      return jsonResponse({ error: "Geçersiz fiyat." }, 400);
    }

    // service-role: pending_payments has no client-facing RLS policies at
    // all (see migration_22.sql) - only this trusted server context ever
    // writes to it
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const conversationId = crypto.randomUUID();
    const nameParts = (profile.name || "ARMUS Kullanıcısı").trim().split(/\s+/);
    const firstName = nameParts[0] || "ARMUS";
    const lastName = nameParts.slice(1).join(" ") || "Kullanıcı";

    // does an available lesson credit cover this booking? Same teacher as
    // the credit covers any lesson type; a credit from a different teacher
    // only covers a trial lesson (see migration_28.sql).
    const { data: credits } = await supabaseAdmin
      .from("lesson_credits")
      .select("*")
      .eq("student_id", user.id)
      .eq("status", "available")
      .order("created_at", { ascending: true });

    let appliedCredit = (credits || []).find((c: any) => c.teacher_id === teacherId) || null;
    if (!appliedCredit && type === "trial" && credits && credits.length > 0) {
      appliedCredit = credits[0];
    }

    // a credit covers this booking - book it now, no card charge, no
    // iyzico step, and deliberately no pending_payments row at all (see
    // this file's header comment for why that matters)
    if (appliedCredit) {

      const { data: booking, error: bookingError } = await supabaseAdmin
        .from("bookings")
        .insert({
          student_id: user.id,
          student_name: profile.name,
          teacher_id: teacherId,
          teacher_name: teacherName,
          type,
          lesson_date: date,
          lesson_time: time,
          price: numericPrice,
        })
        .select()
        .single();

      if (bookingError || !booking) {
        console.error("credit-covered booking insert failed", bookingError);
        return jsonResponse({ error: "Rezervasyon oluşturulamadı." }, 500);
      }

      await supabaseAdmin
        .from("lesson_credits")
        .update({ status: "used", used_booking_id: booking.id, used_at: new Date().toISOString() })
        .eq("id", appliedCredit.id);

      return jsonResponse({ bookedDirectly: true, creditApplied: true });
    }

    const cleanPhone = String(phone || "").replace(/[^\d+]/g, "");
    if (cleanPhone.replace(/\D/g, "").length < 10) {
      return jsonResponse({ error: "Geçerli bir telefon numarası gir." }, 400);
    }

    const cleanIdentity = String(identityNumber || "").trim();
    if (!looksLikeIdentityNumber(cleanIdentity)) {
      return jsonResponse({ error: "Geçerli bir T.C. kimlik numarası gir (11 haneli)." }, 400);
    }

    const { data: pending, error: pendingError } = await supabaseAdmin
      .from("pending_payments")
      .insert({
        conversation_id: conversationId,
        student_id: user.id,
        student_name: profile.name,
        teacher_id: teacherId,
        teacher_name: teacherName,
        type,
        lesson_date: date,
        lesson_time: time,
        price: numericPrice,
        status: "pending",
      })
      .select()
      .single();

    if (pendingError || !pending) {
      console.error("pending_payments insert failed", pendingError);
      return jsonResponse({ error: "Ödeme başlatılamadı." }, 500);
    }

    const callbackUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/payment-callback`;
    const addressLine = profile.city || "Türkiye";

    const iyzicoRequest = {
      locale: Iyzipay.LOCALE.TR,
      conversationId,
      price: numericPrice.toFixed(2),
      paidPrice: numericPrice.toFixed(2),
      currency: Iyzipay.CURRENCY.TRY,
      basketId: pending.id,
      paymentGroup: Iyzipay.PAYMENT_GROUP.PRODUCT,
      callbackUrl,
      buyer: {
        id: user.id,
        name: firstName,
        surname: lastName,
        gsmNumber: cleanPhone,
        email: profile.email || user.email,
        identityNumber: cleanIdentity,
        registrationAddress: addressLine,
        ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "85.34.78.112",
        city: profile.city || "İstanbul",
        country: "Turkey",
      },
      shippingAddress: {
        contactName: profile.name || "ARMUS Kullanıcısı",
        city: profile.city || "İstanbul",
        country: "Turkey",
        address: addressLine,
      },
      billingAddress: {
        contactName: profile.name || "ARMUS Kullanıcısı",
        city: profile.city || "İstanbul",
        country: "Turkey",
        address: addressLine,
      },
      basketItems: [
        {
          id: pending.id,
          name: `${type === "trial" ? "Deneme Dersi" : "Ders"} - ${teacherName}`,
          category1: "Eğitim",
          itemType: Iyzipay.BASKET_ITEM_TYPE.VIRTUAL,
          price: numericPrice.toFixed(2),
        },
      ],
    };

    const result: any = await new Promise((resolve, reject) => {
      iyzipay.checkoutFormInitialize.create(iyzicoRequest, (err: unknown, res: unknown) => {
        if (err) reject(err); else resolve(res);
      });
    });

    if (result.status !== "success") {
      await supabaseAdmin.from("pending_payments").update({ status: "failed" }).eq("id", pending.id);
      console.error("iyzico initialize failed", result);
      return jsonResponse({ error: result.errorMessage || "Ödeme başlatılamadı." }, 500);
    }

    await supabaseAdmin
      .from("pending_payments")
      .update({ iyzico_token: result.token })
      .eq("id", pending.id);

    return jsonResponse({ paymentPageUrl: result.paymentPageUrl });

  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Beklenmeyen bir hata oluştu." }, 500);
  }
});
