// ARMUS - starts an iyzico Checkout Form charge that only adds money to
// the student's ARMUS wallet balance (no booking attached). Called from
// wallet.html when the student submits the "Para Ekle" form.
//
// There is deliberately no way to cash a wallet balance back out to a
// card - a top-up (like a cancellation credit) can only ever be spent on
// a future booking (see create-payment).
//
// Needs these secrets set (Edge Functions -> Manage secrets):
//   IYZICO_API_KEY, IYZICO_SECRET_KEY
// Optional:
//   IYZICO_BASE_URL (defaults to the iyzico sandbox)

import Iyzipay from "npm:iyzipay@^2.0.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const iyzipay = new Iyzipay({
  apiKey: Deno.env.get("IYZICO_API_KEY") ?? "",
  secretKey: Deno.env.get("IYZICO_SECRET_KEY") ?? "",
  uri: Deno.env.get("IYZICO_BASE_URL") ?? "https://sandbox-api.iyzipay.com",
});

const MIN_TOPUP = 50;

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
    const { amount, phone, identityNumber } = body;

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount < MIN_TOPUP) {
      return jsonResponse({ error: `En az ₺${MIN_TOPUP} ekleyebilirsin.` }, 400);
    }

    const cleanPhone = String(phone || "").replace(/[^\d+]/g, "");
    if (cleanPhone.replace(/\D/g, "").length < 10) {
      return jsonResponse({ error: "Geçerli bir telefon numarası gir." }, 400);
    }

    const cleanIdentity = String(identityNumber || "").trim();
    if (!looksLikeIdentityNumber(cleanIdentity)) {
      return jsonResponse({ error: "Geçerli bir T.C. kimlik numarası gir (11 haneli)." }, 400);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const conversationId = crypto.randomUUID();
    const nameParts = (profile.name || "ARMUS Kullanıcısı").trim().split(/\s+/);
    const firstName = nameParts[0] || "ARMUS";
    const lastName = nameParts.slice(1).join(" ") || "Kullanıcı";

    const { data: topup, error: topupError } = await supabaseAdmin
      .from("wallet_topups")
      .insert({ student_id: user.id, amount: numericAmount })
      .select()
      .single();

    if (topupError || !topup) {
      console.error("wallet_topups insert failed", topupError);
      return jsonResponse({ error: "İşlem başlatılamadı." }, 500);
    }

    const callbackUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/wallet-topup-callback`;
    const addressLine = profile.city || "Türkiye";

    const iyzicoRequest = {
      locale: Iyzipay.LOCALE.TR,
      conversationId,
      price: numericAmount.toFixed(2),
      paidPrice: numericAmount.toFixed(2),
      currency: Iyzipay.CURRENCY.TRY,
      basketId: topup.id,
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
          id: topup.id,
          name: "ARMUS Cüzdan Yüklemesi",
          category1: "Cüzdan",
          itemType: Iyzipay.BASKET_ITEM_TYPE.VIRTUAL,
          price: numericAmount.toFixed(2),
        },
      ],
    };

    const result: any = await new Promise((resolve, reject) => {
      iyzipay.checkoutFormInitialize.create(iyzicoRequest, (err: unknown, res: unknown) => {
        if (err) reject(err); else resolve(res);
      });
    });

    if (result.status !== "success") {
      await supabaseAdmin.from("wallet_topups").update({ status: "failed" }).eq("id", topup.id);
      console.error("iyzico initialize failed", result);
      return jsonResponse({ error: result.errorMessage || "Ödeme başlatılamadı." }, 500);
    }

    await supabaseAdmin
      .from("wallet_topups")
      .update({ iyzico_token: result.token })
      .eq("id", topup.id);

    return jsonResponse({ paymentPageUrl: result.paymentPageUrl });

  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Beklenmeyen bir hata oluştu." }, 500);
  }
});
