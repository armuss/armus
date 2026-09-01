// ARMUS - starts an iyzico Checkout Form payment for a booking, applying
// the student's wallet balance (see migration_25.sql/26.sql) against the
// price first.
//
// Called from booking.html (armusSupabase.functions.invoke("create-payment", ...))
// right when the student clicks "Onayla". Three outcomes:
//   - wallet balance >= price: the booking is created directly, right
//     here, with no iyzico step at all - response is { bookedDirectly: true }
//   - wallet balance covers part of it: only the remainder is charged to
//     the card via iyzico - response is { paymentPageUrl }
//   - no wallet balance: unchanged, full price charged to the card
// Either way nothing is written to the real "bookings" table for a card
// payment - a pending_payments row is created instead, and the booking
// itself is only created by payment-callback once iyzico confirms the
// charge actually succeeded. This is what stops a student from getting a
// lesson slot without paying (or a slot being held forever for a payment
// that never completes). The wallet portion is only actually debited once
// the booking is confirmed (immediately below for a wallet-only booking,
// or in payment-callback for a partial one) - never upfront, so an
// abandoned or failed card charge can't lose wallet money for nothing.
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
      .select("name, email, city, wallet_balance")
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

    // Temporarily disabled - wallet is on hold for now, so checkout never
    // applies the student's balance, even though it's still sitting there
    // in profiles.wallet_balance. Change back to
    // `Number(profile.wallet_balance || 0)` to re-enable.
    const walletBalance = 0;
    const walletApplied = Math.max(0, Math.min(walletBalance, numericPrice));
    const remainingPrice = Math.round((numericPrice - walletApplied) * 100) / 100;

    // only needed when there's an actual card charge - a wallet-only
    // booking never touches iyzico, so nothing to validate here
    let cleanPhone = "";
    let cleanIdentity = "";

    if (remainingPrice > 0) {
      cleanPhone = String(phone || "").replace(/[^\d+]/g, "");
      if (cleanPhone.replace(/\D/g, "").length < 10) {
        return jsonResponse({ error: "Geçerli bir telefon numarası gir." }, 400);
      }

      cleanIdentity = String(identityNumber || "").trim();
      if (!looksLikeIdentityNumber(cleanIdentity)) {
        return jsonResponse({ error: "Geçerli bir T.C. kimlik numarası gir (11 haneli)." }, 400);
      }
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
        wallet_applied: walletApplied,
        status: remainingPrice <= 0 ? "succeeded" : "pending",
      })
      .select()
      .single();

    if (pendingError || !pending) {
      console.error("pending_payments insert failed", pendingError);
      return jsonResponse({ error: "Ödeme başlatılamadı." }, 500);
    }

    // wallet balance covers the whole price - book it now, no card charge
    // and no iyzico step needed at all
    if (remainingPrice <= 0) {

      if (walletApplied > 0) {
        await supabaseAdmin.from("profiles").update({ wallet_balance: walletBalance - walletApplied }).eq("id", user.id);
      }

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
        console.error("wallet-covered booking insert failed", bookingError);
        // wallet was already debited above - put it back, nothing was booked
        if (walletApplied > 0) {
          await supabaseAdmin.from("profiles").update({ wallet_balance: walletBalance }).eq("id", user.id);
        }
        await supabaseAdmin.from("pending_payments").update({ status: "failed" }).eq("id", pending.id);
        return jsonResponse({ error: "Rezervasyon oluşturulamadı." }, 500);
      }

      await supabaseAdmin.from("pending_payments").update({ booking_id: booking.id }).eq("id", pending.id);

      if (walletApplied > 0) {
        await supabaseAdmin.from("wallet_transactions").insert({
          student_id: user.id,
          amount: -walletApplied,
          reason: "booking_payment",
          booking_id: booking.id,
        });
      }

      return jsonResponse({ bookedDirectly: true });
    }

    const callbackUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/payment-callback`;
    const addressLine = profile.city || "Türkiye";

    const iyzicoRequest = {
      locale: Iyzipay.LOCALE.TR,
      conversationId,
      price: remainingPrice.toFixed(2),
      paidPrice: remainingPrice.toFixed(2),
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
          name: `${type === "trial" ? "Deneme Dersi" : "Ders"} - ${teacherName}${walletApplied > 0 ? " (cüzdan indirimi uygulandı)" : ""}`,
          category1: "Eğitim",
          itemType: Iyzipay.BASKET_ITEM_TYPE.VIRTUAL,
          price: remainingPrice.toFixed(2),
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
