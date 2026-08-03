// OSC Performance — Service Worker v5

self.addEventListener("push", (event) => {
  if (!event.data) return;
  const data = event.data.json();
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || "osc-push",
    renotify: true,
    vibrate: [200, 100, 200],
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(data.title || "OSC Performance", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
      const existing = cs.find((c) => c.url.includes(url) && "focus" in c);
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});

// Skip waiting immediately so new version activates right away
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => e.waitUntil(clients.claim()));

// Never cache HTML or version.json — always fetch fresh from network
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname === "/" || url.pathname.endsWith(".html") || url.pathname.includes("version.json")) {
    e.respondWith(fetch(e.request, {cache:"no-store"}).catch(() => caches.match(e.request)));
  }
});

self.addEventListener("message", (e) => {
  if (e.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
