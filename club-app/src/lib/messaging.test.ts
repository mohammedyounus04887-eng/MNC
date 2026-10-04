import { describe, expect, it, vi } from "vitest";

const messaging = vi.hoisted(() => ({
    getMessaging: vi.fn(), getToken: vi.fn(), onMessage: vi.fn(),
    deleteToken: vi.fn(), isSupported: vi.fn(),
}));
const firestore = vi.hoisted(() => ({
    doc: vi.fn(), updateDoc: vi.fn(), arrayUnion: vi.fn(),
    arrayRemove: vi.fn(), getDoc: vi.fn(),
}));
vi.mock("firebase/messaging", () => messaging);
vi.mock("firebase/firestore", () => firestore);
vi.mock("./firebase", () => ({ default: {}, db: {}, useFirebaseEmulators: true }));

import {
    isPushSupported, enablePushForMember, disablePushForMember,
    syncPushTokenSilently, subscribeToForegroundMessages,
} from "./messaging";

describe("emulator demo messaging isolation", () => {
    it("does not create an FCM client or register a push token", async () => {
        const member = { clubId: "dev_club", memberId: "synthetic-member" };
        expect(await isPushSupported()).toBe(false);
        await expect(enablePushForMember(member)).rejects.toThrow("disabled in the local emulator demo");
        await disablePushForMember(member);
        await syncPushTokenSilently({ ...member, notificationsEnabled: true });
        const unsubscribe = subscribeToForegroundMessages(vi.fn());
        unsubscribe();
        for (const mock of Object.values(messaging)) expect(mock).not.toHaveBeenCalled();
        for (const mock of Object.values(firestore)) expect(mock).not.toHaveBeenCalled();
    });
});
