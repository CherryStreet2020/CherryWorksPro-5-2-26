/**
 * The signed-in chrome — sidebar, help panel (+ every help article and the markdown
 * renderer), Cherry Assist, command palette, notification bell, brand switcher, banners,
 * admin setup gate. Loaded lazily so an anonymous visitor on a marketing page never
 * downloads any of it; both authenticated layouts and the admin setup gate share these
 * boundaries. preloadSignedInChrome() starts the fetches the moment someone is signed in,
 * so the header's Help / Search actions have their listeners within a network round trip.
 */
import { lazyNamed } from "@/lib/lazy";

const loadSidebar = () => import("@/components/app-sidebar");
const loadHelpPanel = () => import("@/components/help-panel");
const loadCherryAssist = () => import("@/components/cherry-assist");
const loadCommandPalette = () => import("@/components/command-palette");
const loadNotificationBell = () => import("@/components/notification-bell");
const loadBrandSwitcher = () => import("@/components/BrandSwitcher");
const loadAdminSetupGate = () => import("@/components/admin-setup-gate");
const loadBanners = () => import("@/components/account-banners");
const loadDeletionBanner = () => import("@/components/deletion-banner");

export const AppSidebar = lazyNamed(loadSidebar, "AppSidebar");
export const HelpPanel = lazyNamed(loadHelpPanel, "HelpPanel");
export const CherryAssist = lazyNamed(loadCherryAssist, "CherryAssist");
export const CommandPalette = lazyNamed(loadCommandPalette, "CommandPalette");
export const NotificationBell = lazyNamed(loadNotificationBell, "NotificationBell");
export const BrandSwitcher = lazyNamed(loadBrandSwitcher, "BrandSwitcher");
export const AdminSetupGate = lazyNamed(loadAdminSetupGate, "AdminSetupGate");
export const VerifyEmailBanner = lazyNamed(loadBanners, "VerifyEmailBanner");
export const TrialCountdownBanner = lazyNamed(loadBanners, "TrialCountdownBanner");
export const DeletionBanner = lazyNamed(loadDeletionBanner, "DeletionBanner");

let preloaded: Promise<unknown> | null = null;
export function preloadSignedInChrome(): Promise<unknown> {
  if (!preloaded) {
    preloaded = Promise.all([loadSidebar(), loadHelpPanel(), loadCherryAssist(), loadCommandPalette(), loadNotificationBell(), loadBrandSwitcher(), loadBanners(), loadDeletionBanner()])
      .catch(() => { preloaded = null; });
  }
  return preloaded;
}
