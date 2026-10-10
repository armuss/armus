// ARMUS - sends a real Web Push notification (RFC8291 payload
// encryption + RFC8292 VAPID auth) to every device a user has
// subscribed from (push_subscriptions, migration_98.sql). Implemented
// directly against the Web Crypto API (crypto.subtle) that Deno,
// browsers, and Node's crypto.webcrypto all share identically - no
// npm "web-push" dependency, since that package leans on Node's legacy
// crypto.createECDH()/http(s).Agent internals that are a much less
// certain fit for Deno's npm compatibility layer than a few dozen lines
// of spec-standard Web Crypto calls.
//
// Fired by two triggers (migration_98.sql): bookings_notify_push (a new
// booking) and notify_new_message (a new message, alongside the
// existing email trigger) - never called directly by the site.
//
// IMPORTANT: after deploying this function, go to its Settings and turn
// OFF "Verify JWT" (Enforce JWT Verification) - the trigger's HTTP call
// carries no Supabase auth token, same as every other trigger-fired
// function in this project.
//
// Needs these secrets set (Edge Functions -> Manage secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (both base64url, see the
//     deployment instructions - generate once, never rotate casually:
//     every existing subscription was made against the public key the
//     browser was given at subscribe time)
//   VAPID_SUBJECT - a "mailto:you@example.com" or site URL some push
//     services use to contact the sender if something's wrong
//   TRIGGER_SECRET - already configured for the other trigger-fired
//     functions, reused here as-is
// Optional:
//   SITE_URL - defaults to "https://armus.com.tr"

import { createClient } from "npm:@supabase/supabase-js@2";

const TRIGGER_SECRET = Deno.env.get("TRIGGER_SECRET") ?? "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:support@armus.com.tr";
const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://armus.com.tr").replace(/\/$/, "");

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// ==== RFC8291/RFC8292 Web Push, pure Web Crypto ====
// Verified against the `web-push`/`http_ece` reference libraries' own
// encrypt/decrypt and VAPID signing during development (byte-for-byte
// round trip) - see the PR description for how.

const subtle = crypto.subtle;

function b64urlToBytes(b64url: string) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64url(bytes: Uint8Array) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
  const key = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

// encrypts `plaintextBytes` for one PushSubscription (its p256dh/auth
// keys, both base64url as stored in push_subscriptions) into the
// aes128gcm body the Push protocol expects on the wire.
async function encryptPushPayload(p256dhB64url: string, authB64url: string, plaintextBytes: Uint8Array) {
  const receiverPublicKeyBytes = b64urlToBytes(p256dhB64url);
  const authSecret = b64urlToBytes(authB64url);

  const receiverPublicKey = await subtle.importKey(
    "raw", receiverPublicKeyBytes, { name: "ECDH", namedCurve: "P-256" }, false, [],
  );

  const senderKeyPair = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const senderPublicKeyBytes = new Uint8Array(await subtle.exportKey("raw", senderKeyPair.publicKey));

  const sharedSecret = new Uint8Array(
    await subtle.deriveBits({ name: "ECDH", public: receiverPublicKey }, senderKeyPair.privateKey, 256),
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));

  const authInfo = new Uint8Array([
    ...new TextEncoder().encode("WebPush: info\0"),
    ...receiverPublicKeyBytes,
    ...senderPublicKeyBytes,
  ]);
  const prk = await hkdf(authSecret, sharedSecret, authInfo, 32);

  const cek = await hkdf(salt, prk, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, prk, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);

  // aes128gcm record: plaintext + delimiter (0x02) + padding (none here)
  const padded = new Uint8Array(plaintextBytes.length + 1);
  padded.set(plaintextBytes, 0);
  padded[plaintextBytes.length] = 0x02;

  const aesKey = await subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const encrypted = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded));

  // header: salt(16) | record size(4, big-endian) | keyid length(1) | keyid (sender's public key, 65 bytes)
  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + senderPublicKeyBytes.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs, false);
  header[20] = senderPublicKeyBytes.length;
  header.set(senderPublicKeyBytes, 21);

  const result = new Uint8Array(header.length + encrypted.length);
  result.set(header, 0);
  result.set(encrypted, header.length);
  return result;
}

async function signVapidJwt(audience: string) {
  const header = { typ: "JWT", alg: "ES256" };
  const payload = { aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUBJECT };
  const encode = (obj: unknown) => bytesToB64url(new TextEncoder().encode(JSON.stringify(obj)));
  const signingInput = `${encode(header)}.${encode(payload)}`;

  const privateKeyBytes = b64urlToBytes(VAPID_PRIVATE_KEY);
  const publicKeyBytes = b64urlToBytes(VAPID_PUBLIC_KEY);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: bytesToB64url(privateKeyBytes),
    x: bytesToB64url(publicKeyBytes.slice(1, 33)),
    y: bytesToB64url(publicKeyBytes.slice(33, 65)),
    ext: true,
  };
  const privateKey = await subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${bytesToB64url(new Uint8Array(sig))}`;
}

async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: Record<string, unknown>,
) {
  const body = await encryptPushPayload(
    subscription.p256dh, subscription.auth, new TextEncoder().encode(JSON.stringify(payload)),
  );
  const audience = new URL(subscription.endpoint).origin;
  const jwt = await signVapidJwt(audience);

  return await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      TTL: "604800",
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      Authorization: `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}`,
    },
    body,
  });
}

Deno.serve(async (req) => {
  try {
    if (!TRIGGER_SECRET || req.headers.get("x-armus-trigger-secret") !== TRIGGER_SECRET) {
      return new Response("unauthorized", { status: 401 });
    }
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return new Response("push not configured", { status: 200 });
    }

    const body = await req.json().catch(() => ({}));

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let targetUserId: string | null = null;
    let title = "ARMUS";
    let notifBody = "";
    let url = `${SITE_URL}/dashboard.html`;

    if (body.type === "booking_new") {
      const { data: booking } = await supabaseAdmin
        .from("bookings").select("*").eq("id", body.booking_id).maybeSingle();

      if (!booking || !isUuid(booking.teacher_id)) return new Response("skip", { status: 200 });

      targetUserId = booking.teacher_id;
      title = "Yeni ders rezervasyonu";
      notifBody = `${booking.student_name} - ${booking.lesson_date} ${booking.lesson_time}`;
      url = `${SITE_URL}/dashboard.html?panel=bookings`;

    } else if (body.type === "message_new") {
      const { data: message } = await supabaseAdmin
        .from("messages").select("*").eq("id", body.message_id).maybeSingle();

      if (!message) return new Response("skip", { status: 200 });

      const { data: conversation } = await supabaseAdmin
        .from("conversations").select("student_id, teacher_id").eq("id", message.conversation_id).maybeSingle();

      if (!conversation) return new Response("skip", { status: 200 });

      targetUserId = conversation.student_id === message.sender_id
        ? conversation.teacher_id
        : conversation.student_id;

      const { data: sender } = await supabaseAdmin
        .from("profiles").select("name").eq("id", message.sender_id).maybeSingle();

      title = `${sender?.name || "Bir kullanıcı"} sana mesaj gönderdi`;
      notifBody = message.body ? message.body.slice(0, 120) : "Yeni bir mesaj";
      url = `${SITE_URL}/mesajlar.html`;

    } else {
      return new Response("unknown type", { status: 200 });
    }

    if (!targetUserId) return new Response("skip", { status: 200 });

    const { data: subscriptions } = await supabaseAdmin
      .from("push_subscriptions").select("*").eq("user_id", targetUserId);

    if (!subscriptions || !subscriptions.length) return new Response("no subscriptions", { status: 200 });

    await Promise.all(subscriptions.map(async (sub) => {
      try {
        const resp = await sendWebPush(sub, { title, body: notifBody, url });
        // 404/410 = the push service says this subscription is gone for
        // good (browser uninstalled, storage cleared, etc) - clean it up
        // so it doesn't keep getting retried on every future notification
        if (resp.status === 404 || resp.status === 410) {
          await supabaseAdmin.from("push_subscriptions").delete().eq("id", sub.id);
        } else if (!resp.ok) {
          console.error("push send failed", sub.endpoint, resp.status, await resp.text());
        }
      } catch (err) {
        console.error("push send threw", sub.endpoint, err);
      }
    }));

    return new Response("sent", { status: 200 });

  } catch (err) {
    console.error(err);
    return new Response("error", { status: 500 });
  }
});
