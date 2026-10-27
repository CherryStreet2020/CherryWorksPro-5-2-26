export function isMarketingOsEnabled(): boolean {
  return process.env.MARKETING_OS_ENABLED === "true";
}

/**
 * Rewrites campaign links and adds the open pixel at send time. Off until
 * set: the release that adds the /api/public/email routes must be live (and
 * be the image a failed deploy rolls back to) before any email carries a
 * link to them. The routes themselves are always on, so turning this off
 * later never breaks a link already delivered.
 */
export function isEmailTrackingEnabled(): boolean {
  return process.env.MARKETING_EMAIL_TRACKING_ENABLED === "true";
}
