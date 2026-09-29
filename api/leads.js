import { db } from '../lib/db.js';
import { hasValidToken } from '../lib/auth.js';

const COLS = 'id, business_name, website, city, category, phone, email, source_url, intent_signal, batch_date, created_at, claimed_at';

function toCsv(rows) {
  const cols = COLS.split(', ');
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Date ? v.toISOString() : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

export default async function handler(req, res) {
  if (!hasValidToken(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const { date, unclaimed, claim, format } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 1000);

  const where = [];
  const params = [];
  if (date) { params.push(date); where.push(`batch_date = $${params.length}`); }
  if (unclaimed === '1') where.push('claimed_at is null');
  params.push(limit);

  const sql = `select ${COLS} from lead_feed.leads
    ${where.length ? 'where ' + where.join(' and ') : ''}
    order by created_at desc limit $${params.length}`;

  try {
    const { rows } = await db().query(sql, params);
    if (claim === '1' && rows.length) {
      await db().query(
        'update lead_feed.leads set claimed_at = now() where id = any($1::uuid[]) and claimed_at is null',
        [rows.map((r) => r.id)]
      );
    }
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return res.status(200).send(toCsv(rows));
    }
    return res.status(200).json({ count: rows.length, leads: rows });
  } catch (e) {
    return res.status(500).json({ error: 'Database error' });
  }
}
