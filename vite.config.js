import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const baseSecurityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const productionCsp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    headers: baseSecurityHeaders,
  },
  preview: {
    headers: {
      ...baseSecurityHeaders,
      'Content-Security-Policy': productionCsp,
    },
  },
});
