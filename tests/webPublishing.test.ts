import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildRobotsTxt,
  buildSitemapXml,
  injectWebPublishMeta,
  normalizeBasePath,
  resolveSiteOrigin,
} from '../src/utils/webPublishConfig.js';

describe('webPublishConfig (SEO, Canonical, Sitemap y Despliegue Web)', () => {
  it('normaliza base paths para raíz y subdirectorios', () => {
    assert.equal(normalizeBasePath(undefined), '/');
    assert.equal(normalizeBasePath(''), '/');
    assert.equal(normalizeBasePath('EQUINOX-V1'), '/EQUINOX-V1/');
    assert.equal(normalizeBasePath('/EQUINOX-V1/'), '/EQUINOX-V1/');
  });

  it('resuelve el origen público desde variables estándar de Vercel, APP_URL o GitHub Pages', () => {
    assert.equal(
      resolveSiteOrigin({ APP_URL: 'https://equinox-books.vercel.app/' }),
      'https://equinox-books.vercel.app'
    );
    assert.equal(
      resolveSiteOrigin({ VERCEL_PROJECT_PRODUCTION_URL: 'equinox.example.com' }),
      'https://equinox.example.com'
    );
    assert.equal(
      resolveSiteOrigin({ GITHUB_REPOSITORY_OWNER: 'CarlosSmith' }),
      'https://carlossmith.github.io'
    );
  });

  it('genera sitemap.xml y robots.txt válidos para raíz y subdirectorio', () => {
    const xml = buildSitemapXml('https://carlossmith.github.io', '/EQUINOX-V1/', '2026-11-26');
    assert.match(xml, /<loc>https:\/\/carlossmith\.github\.io\/EQUINOX-V1\/<\/loc>/);
    assert.match(xml, /<loc>https:\/\/carlossmith\.github\.io\/EQUINOX-V1\/privacidad\.html<\/loc>/);

    const robots = buildRobotsTxt('https://equinox-books.vercel.app', '/');
    assert.match(robots, /Sitemap: https:\/\/equinox-books\.vercel\.app\/sitemap\.xml/);
    assert.match(robots, /Disallow: \/api\//);
  });

  it('inyecta URLs canónicas, og:image y favicon respetando dominio y base path', () => {
    const sampleHtml = `
      <meta name="x-equinox-canonical-placeholder" content="true" />
      <meta property="og:image" content="/og-cover.jpg" />
      <meta name="twitter:image" content="/og-cover.jpg" />
      <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
      <link rel="icon" type="image/svg+xml" href="/icon.svg" />
      <link rel="icon" type="image/png" sizes="192x192" href="/pwa-192x192.png" />
    `;
    const rendered = injectWebPublishMeta(sampleHtml, {
      base: '/EQUINOX-V1/',
      origin: 'https://carlossmith.github.io',
    });
    assert.match(rendered, /<link rel="canonical" id="eqx-canonical" href="https:\/\/carlossmith\.github\.io\/EQUINOX-V1\/" \/>/);
    assert.match(rendered, /<meta property="og:url" id="eqx-og-url" content="https:\/\/carlossmith\.github\.io\/EQUINOX-V1\/" \/>/);
    assert.match(rendered, /content="https:\/\/carlossmith\.github\.io\/EQUINOX-V1\/og-cover\.jpg"/);
    assert.match(rendered, /href="\/EQUINOX-V1\/icon\.svg"/);
    assert.match(rendered, /href="\/EQUINOX-V1\/pwa-192x192\.png"/);
  });
});
