import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getTranslate } from "@/lib/locale-server";
import { DEMO_ROLES, demoRoleForUid, isDemoMode } from "@/lib/demo";
import AppNav from "@/components/AppNav";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";
import OfflineSync from "@/components/OfflineSync";
import DemoSwitcher from "@/components/DemoSwitcher";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  // Cookie exists (proxy let them through) but the JWT is invalid — clear it.
  if (!user) redirect("/api/auth/logout");

  // Translated here rather than inside AppNav: the nav is a client component, and
  // resolving the dictionary there would ship all five languages to the browser to
  // render six words.
  const { t } = await getTranslate();
  const navLabels = {
    home: t("nav.home"),
    prospects: t("nav.prospects"),
    log: t("nav.log"),
    team: t("nav.team"),
    threads: t("nav.threads"),
    settings: t("nav.settings"),
  };

  return (
    <div className="min-h-dvh md:flex">
      <ServiceWorkerRegistrar />
      <OfflineSync />
      {/* Renders only when DEMO_MODE is set. In production this whole subtree, and the
          component's JavaScript, is never reached. */}
      {isDemoMode() && (
        <DemoSwitcher
          roles={DEMO_ROLES}
          currentKey={demoRoleForUid(user.id)?.key ?? null}
          currentName={user.name}
        />
      )}
      <AppNav
        userName={user.name}
        userPhotoUrl={user.photoUrl}
        labels={navLabels}
      />
      <div className="min-w-0 flex-1">
        <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-20 md:px-10 md:pb-12 md:pt-10">
          {children}
        </main>
      </div>
    </div>
  );
}
