// ARMUS service worker - exists only to receive Web Push events and show
// a system notification (migration_98.sql / send-push-notification Edge
// Function). Registered once from dashboard.html's "Bildirimler" section
// (navigator.serviceWorker.register("/sw.js")); applies site-wide since
// it's served from the origin root, but nothing else on the site depends
// on it - every page works identically with no service worker at all.

self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_e) { /* ignore */ }

  const title = data.title || "ARMUS";
  const options = {
    body: data.body || "",
    icon: "/favicon-32x32.png",
    badge: "/favicon-32x32.png",
    data: { url: data.url || "/dashboard.html" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/dashboard.html";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clientsArr => {
      for (const client of clientsArr) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
