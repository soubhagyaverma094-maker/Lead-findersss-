import { db } from '../lib/db.js';
import { safeEqual } from '../lib/auth.js';

const TARGET = 100;
const MODEL = 'claude-sonnet-5-5';

const CITIES = [
  'Mumbai','Delhi NCR','Bengaluru','Hyderabad','Chennai','Pune','Kolkata','Ahmedabad','Jaipur','Surat',
  'Lucknow','Indore','Bhopal','Raipur','Nagpur','Chandigarh','Kochi','Coimbatore','Visakhapatnam','Patna',
  'Vadodara','Nashik','Bhubaneswar','Ranchi','Dehradun','Mysuru','Thiruvananthapuram','Guwahati','Amritsar','Jodhpur',
];

const INTENTS = [
  'companies currently posting job openings for digital marketing, SEO, social media or performance marketing roles (they need marketing help)',
  'businesses or founders publicly asking for a digital marketing agency, SEO help or website/ads help (LinkedIn, Quora, Reddit, Facebook groups, forums)',
  'recently launched or newly funded businesses with little or no online presence that would need digital marketing',
];

function pick(arr, n, offset) {
  return Array.from({ length: n }, (_, i) => arr[(offset + i) % arr.length]);
}

async function askClaude(city, intent) {
  const prompt = `Find up to 12 real Indian businesses in or near ${city} that show buying intent for digital marketing services. Focus on: ${intent}.

Use web search. Only include businesses you found evidence for. Never invent phone numbers, emails or websites: use null when unknown.
Return ONLY a JSON array, no other text. Each item:
{"business_name":string,"website":string|null,"city":string,"category":string,"phone":string|null,"email":string|null,"source_url":string,"intent_signal":string}`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!r.ok) throw new Error(`Claude ${r.status}`);
  const data = await r.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end < start) return [];
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return []; }
}

function keyFor(l) {
  const site = (l.website || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  return site || `${(l.business_name || '').toLowerCase().trim()}|${(l.city || '').toLowerCase().trim()}`;
}

export default async function handler(req, res) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!process.env.CRON_SECRET || !safeEqual(bearer, process.env.CRON_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const dayNum = Math.floor(Date.now() / 86400000);
  let inserted = 0;
  const seen = new Set();

  for (let round = 0; round < 3 && inserted < TARGET; round++) {
    const cities = pick(CITIES, 10, dayNum * 3 + round * 10);
    const jobs = cities.map((c, i) => askClaude(c, INTENTS[(i + round) % INTENTS.length]).catch(() => []));
    const results = (await Promise.all(jobs)).flat();

    for (const l of results) {
      if (inserted >= TARGET) break;
      if (!l || !l.business_name) continue;
      const key = keyFor(l);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const r = await db().query(
        `insert into lead_feed.leads
          (dedupe_key, business_name, website, city, category, phone, email, source_url, intent_signal)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (dedupe_key) do nothing`,
        [key, l.business_name, l.website, l.city, l.category, l.phone, l.email, l.source_url, l.intent_signal]
      );
      inserted += r.rowCount;
    }
  }
  return res.status(200).json({ inserted });
}
