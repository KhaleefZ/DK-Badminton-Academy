import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Writes Cloudflare's `_headers` file into the build, so every admin page is served with security
 * headers (free on Workers static assets). Stricter than the website: no payment scripts or frames.
 * The API address comes from VITE_API_URL, the same value the admin panel calls.
 */
function securityHeaders(apiUrl) {
  const api = new URL(apiUrl).origin;
  const https = api.startsWith('https://');
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data: blob: ${api}`,
    `connect-src 'self' ${api}`,
    "frame-src 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    ...(https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  const lines = [
    '/*',
    `  Content-Security-Policy: ${csp}`,
    '  X-Content-Type-Options: nosniff',
    '  X-Frame-Options: DENY',
    // The admin panel's addresses (e.g. a booking number) never go to other sites.
    '  Referrer-Policy: no-referrer',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()',
    '  Cross-Origin-Opener-Policy: same-origin',
    // Search engines have no business indexing the admin panel.
    '  X-Robots-Tag: noindex, nofollow',
    ...(https ? ['  Strict-Transport-Security: max-age=31536000'] : []),
    '',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
  ];
  return {
    name: 'dk-security-headers',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: lines.join('\n') });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react(), securityHeaders(env.VITE_API_URL || 'http://localhost:8787')],
    server: { port: 5174 },
    preview: { port: 4174 },
  };
});
