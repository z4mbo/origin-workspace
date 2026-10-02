// Public origin used for absolute metadata URLs. Set NEXT_PUBLIC_SITE_URL at build time.
export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.ORIGIN_PUBLIC_URL || "http://localhost:3000";
