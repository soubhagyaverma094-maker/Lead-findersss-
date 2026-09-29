import { timingSafeEqual } from 'node:crypto';

export function safeEqual(a = '', b = '') {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export function hasValidToken(req) {
  const expected = process.env.LEADS_API_TOKEN;
  if (!expected) return false;
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const given = bearer || req.headers['x-api-key'] || '';
  return safeEqual(given, expected);
}
