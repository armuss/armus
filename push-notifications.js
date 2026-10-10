/*
 * ARMUS - browser push notification subscribe/unsubscribe (Web Push API,
 * migration_98.sql). The VAPID public key is meant to be public - it's
 * what pushManager.subscribe() hands the push service so it can verify
 * later pushes really come from ARMUS's server, not a secret in itself.
 * Requires supabase-config.js (Supabase SDK + armusSupabase client) to be
 * loaded before this file.
 */

const ARMUS_VAPID_PUBLIC_KEY = "BCfuiwlwiGBU1s4Gy66G5QTAcvoe_EPf6IUT6zEaO4jZox7_pYSU0MNq_M2AxFAhVnRb8B6wSZJIPUIop6tpHE8";

function armusPushSupported() {
  return !!navigator.serviceWorker && "PushManager" in window && "Notification" in window;
}

function armusUrlBase64ToUint8Array(base64url) {
  const padding = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

// "unsupported" | "denied" | "subscribed" | "not-subscribed" - the
// service worker/push APIs can exist on `navigator`/`window` as a
// surface (so armusPushSupported() returns true) yet still throw
// SYNCHRONOUSLY the moment they're actually called, on an insecure
// origin or under some browser privacy modes/policies - never just a
// rejected promise, so this needs a real try/catch, not just .catch().
async function armusGetPushSubscriptionStatus() {
  if (!armusPushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return "not-subscribed";

    const subscription = await registration.pushManager.getSubscription();
    return subscription ? "subscribed" : "not-subscribed";
  } catch (_err) {
    return "unsupported";
  }
}

async function armusEnablePushNotifications(userId) {
  if (!armusPushSupported()) return false;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;

    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: armusUrlBase64ToUint8Array(ARMUS_VAPID_PUBLIC_KEY),
    });

    const key = subscription.getKey ? subscription.getKey("p256dh") : null;
    const authSecret = subscription.getKey ? subscription.getKey("auth") : null;
    const p256dh = key ? btoa(String.fromCharCode(...new Uint8Array(key))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : "";
    const auth = authSecret ? btoa(String.fromCharCode(...new Uint8Array(authSecret))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : "";

    const { error } = await armusSupabase
      .from("push_subscriptions")
      .upsert(
        { user_id: userId, endpoint: subscription.endpoint, p256dh, auth },
        { onConflict: "endpoint" },
      );

    if (error) {
      await subscription.unsubscribe();
      return false;
    }
    return true;
  } catch (_err) {
    return false;
  }
}

async function armusDisablePushNotifications(userId) {
  if (!armusPushSupported()) return true;

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return true;

    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return true;

    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();

    const { error } = await armusSupabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", userId)
      .eq("endpoint", endpoint);

    return !error;
  } catch (_err) {
    return false;
  }
}
