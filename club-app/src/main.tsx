import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter } from "react-router-dom";
import { ClubProvider } from "@/lib/clubDetection";
import { AuthProvider } from "@/lib/auth";
import App from "./App.tsx";
import "./index.css";
import "./styles/print.css";


// ─── Stale-chunk recovery ─────────────────────────────────────────────
// When a new deploy ships, the old service worker can still hold cached
// references to chunks that no longer exist on the CDN. The browser then
// throws "ChunkLoadError" / "Loading chunk X failed" and the page goes
// blank. Detect that and hard-reload — fetches the fresh index.html and
// its new chunk filenames. Once per page-load max to avoid reload loops.
let _reloadedForChunkError = false;
function handleChunkLoadError(reason: unknown) {
    const msg = String((reason as any)?.message ?? reason ?? "");
    if (
        !_reloadedForChunkError &&
        (msg.includes("Loading chunk") || msg.includes("ChunkLoadError") ||
         msg.includes("Failed to fetch dynamically imported module") ||
         msg.includes("Importing a module script failed"))
    ) {
        _reloadedForChunkError = true;
        console.warn("[main] chunk load error — hard reloading to fetch fresh bundle:", msg);
        // Clear caches first so the reload doesn't immediately hit the same
        // stale entry.
        if ("caches" in window) {
            caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
                  .finally(() => (window as Window).location.reload());
        } else {
            (window as Window).location.reload();
        }
    }
}
window.addEventListener("error", (e) => handleChunkLoadError((e as ErrorEvent).error || e.message));
window.addEventListener("unhandledrejection", (e) => handleChunkLoadError(e.reason));

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 2 * 60 * 1000,      // Data is fresh for 2 min — no re-fetch on nav
            gcTime: 10 * 60 * 1000,         // Keep unused cache for 10 min
            refetchOnWindowFocus: false,     // Don't re-fetch when user alt-tabs back
            retry: 1,                        // Only retry once on failure
        },
    },
});

createRoot(document.getElementById("root")!).render(
    <QueryClientProvider client={queryClient}>
        <ClubProvider>
            <AuthProvider>
                <TooltipProvider>
                    <BrowserRouter>
                        <App />
                    </BrowserRouter>
                </TooltipProvider>
            </AuthProvider>
        </ClubProvider>
    </QueryClientProvider>
);
