/* eslint-disable no-undef */
// Firebase Cloud Messaging service worker.
// Handles push notifications when the app is closed or in the background.
// Foreground messages are handled in src/lib/messaging.ts via onMessage().

// Use the compat SDK loaded from gstatic — the only API service workers can
// reliably use. Versions are pinned to avoid breakage on Firebase upgrades.
// This asset is generated from the selected Vite profile, never a fixed project.
importScripts('/firebase-messaging-config.js');
if (self.__CLUB_FIREBASE_CONFIG__) {
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');
firebase.initializeApp(self.__CLUB_FIREBASE_CONFIG__);
const messaging = firebase.messaging();

// Background / closed-app messages. The browser shows the notification.
messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title || payload.data?.title || 'Magic Nutrition Club';
    const body = payload.notification?.body || payload.data?.body || '';
    const url = payload.data?.url || '/member/dashboard';
    self.registration.showNotification(title, {
        body,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag: payload.data?.tag || 'mnc-notification',
        data: { url },
    });
});
}

// When user clicks a notification, focus the app or open the relevant page.
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = event.notification.data?.url || '/member/dashboard';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if ('focus' in client) {
                    client.navigate(targetUrl);
                    return client.focus();
                }
            }
            if (clients.openWindow) return clients.openWindow(targetUrl);
        }),
    );
});
