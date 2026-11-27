/**
 * Utilidades puras para configuración de publicación web (SEO, OpenGraph, Canonical,
 * Sitemap, Robots.txt y resolución dinámica de base path y dominio).
 */

export function normalizeBasePath(raw?: string): string {
  if (!raw || raw.trim() === '') return '/';
  let b = raw.trim();
  if (!b.startsWith('/')) b = `/${b}`;
  if (!b.endsWith('/')) b = `${b}/`;
  return b;
}

function normalizeHttpOrigin(candidate?: string | null): string {
  if (!candidate) return '';
  const trimmed = candidate.trim();
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.origin;
  } catch {
    return '';
  }
}

export function resolveSiteOrigin(env: Record<string, string | undefined>): string {
  const candidates = [
    env.VITE_SITE_URL,
    env.SITE_URL,
    env.APP_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL,
    env.VERCEL_URL,
    env.CF_PAGES_URL,
    env.URL,
  ];
  for (const cand of candidates) {
    const origin = normalizeHttpOrigin(cand);
    if (origin) return origin;
  }

  const ghOwner = (env.GITHUB_REPOSITORY_OWNER || '').trim();
  if (ghOwner) {
    return `https://${ghOwner.toLowerCase()}.github.io`;
  }

  return '';
}

export function buildPublicBaseUrl(origin: string, base = '/'): string {
  const normalizedBase = normalizeBasePath(base);
  const cleanOrigin = origin.replace(/\/+$/, '');
  return cleanOrigin ? `${cleanOrigin}${normalizedBase}` : normalizedBase;
}

export function buildSitemapXml(
  origin: string,
  base = '/',
  lastmod = new Date().toISOString().slice(0, 10)
): string {
  const rootUrl = buildPublicBaseUrl(origin, base);
  const entries = [
    { path: '', changefreq: 'weekly', priority: '1.0' },
    { path: 'privacidad.html', changefreq: 'monthly', priority: '0.6' },
    { path: 'terminos.html', changefreq: 'monthly', priority: '0.6' },
    { path: 'aviso-legal.html', changefreq: 'monthly', priority: '0.5' },
  ];

  const urls = entries
    .map(
      (entry) => `  <url>
    <loc>${rootUrl}${entry.path}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap.xml">
${urls}
</urlset>
`;
}

export function buildRobotsTxt(origin: string, base = '/'): string {
  const normalizedBase = normalizeBasePath(base);
  const rootUrl = buildPublicBaseUrl(origin, normalizedBase);
  return `User-agent: *
Allow: ${normalizedBase}
Allow: ${normalizedBase}privacidad.html
Allow: ${normalizedBase}terminos.html
Allow: ${normalizedBase}aviso-legal.html
Disallow: ${normalizedBase}api/

Sitemap: ${rootUrl}sitemap.xml
`;
}

export function injectWebPublishMeta(
  html: string,
  opts: { base?: string; origin?: string }
): string {
  const base = normalizeBasePath(opts.base);
  const cleanOrigin = (opts.origin || '').replace(/\/+$/, '');
  const publicUrl = buildPublicBaseUrl(cleanOrigin, base);
  const assetPrefix = cleanOrigin ? publicUrl : base;
  const ogImageUrl = `${assetPrefix}og-cover.jpg`;

  let next = html;
  if (cleanOrigin) {
    const canonicalTags = `<link rel="canonical" id="eqx-canonical" href="${publicUrl}" />\n    <meta property="og:url" id="eqx-og-url" content="${publicUrl}" />`;
    if (/<meta\s+name="x-equinox-canonical-placeholder"[^>]*\/?>/i.test(next)) {
      next = next.replace(
        /<meta\s+name="x-equinox-canonical-placeholder"[^>]*\/?>/i,
        canonicalTags
      );
    } else {
      next = next.replace(
        /<link\s+rel="canonical"\s+id="eqx-canonical"\s+href="[^"]*"\s*\/?>/i,
        `<link rel="canonical" id="eqx-canonical" href="${publicUrl}" />`
      );
      next = next.replace(
        /<meta\s+property="og:url"\s+id="eqx-og-url"\s+content="[^"]*"\s*\/?>/i,
        `<meta property="og:url" id="eqx-og-url" content="${publicUrl}" />`
      );
    }
  }
  next = next.replace(
    /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/i,
    `<meta property="og:image" content="${ogImageUrl}" />`
  );
  next = next.replace(
    /<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/i,
    `<meta name="twitter:image" content="${ogImageUrl}" />`
  );
  next = next.replace(
    /<link\s+rel="apple-touch-icon"([^>]*)href="[^"]*"\s*\/?>/i,
    `<link rel="apple-touch-icon"$1href="${base}apple-touch-icon.png" />`
  );
  next = next.replace(
    /<link\s+rel="icon"\s+type="image\/svg\+xml"\s+href="[^"]*"\s*\/?>/i,
    `<link rel="icon" type="image/svg+xml" href="${base}icon.svg" />`
  );
  next = next.replace(
    /<link\s+rel="icon"\s+type="image\/png"\s+sizes="192x192"\s+href="[^"]*"\s*\/?>/i,
    `<link rel="icon" type="image/png" sizes="192x192" href="${base}pwa-192x192.png" />`
  );

  return next;
}
