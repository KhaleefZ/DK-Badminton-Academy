import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Writes Cloudflare's `_headers` file into the build, so every page of the website is served with
 * security headers (free on Workers static assets). The API address comes from VITE_API_URL, the same
 * value the site calls, so the Content Security Policy always matches the deployment.
 * Payment windows: Razorpay and Cashfree load their own scripts, frames and requests, so their domains are allowed.
 */
function securityHeaders(apiUrl) {
  const api = new URL(apiUrl).origin;
  const https = api.startsWith('https://');
  const csp = [
    "default-src 'self'",
    "script-src 'self' https://checkout.razorpay.com https://*.razorpay.com https://sdk.cashfree.com",
    // Motion sets inline styles; Google Fonts serves the stylesheet.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data: blob: ${api} https://*.razorpay.com`,
    `connect-src 'self' ${api} https://*.razorpay.com https://*.cashfree.com`,
    'frame-src https://*.razorpay.com https://*.cashfree.com',
    "form-action 'self' https://*.razorpay.com https://*.cashfree.com",
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
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()',
    '  Cross-Origin-Opener-Policy: same-origin-allow-popups',
    // One year of HTTPS-only. No includeSubDomains, so other subdomains (e.g. Hostinger webmail) aren't forced.
    ...(https ? ['  Strict-Transport-Security: max-age=31536000'] : []),
    '',
    // Built files have a content hash in their name, so they can be cached for good.
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
    server: { port: 5173 },
    preview: { port: 4173 },
  };
});
