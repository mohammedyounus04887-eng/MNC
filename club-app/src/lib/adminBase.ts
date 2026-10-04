/**
 * Returns the admin section base path from the current URL.
 * The owner pages are reused under /admin/*, /login/*, or /owner/*.
 * This function returns the correct base so navigations work from any mount point.
 */
export function getAdminBase(): string {
    const p = window.location.pathname;
    if (p.startsWith("/admin")) return "/admin";
    if (p.startsWith("/login")) return "/login";
    return "/owner";
}
