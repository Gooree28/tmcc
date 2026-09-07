import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = Number.parseInt(process.env.PORT || '3000', 10);
const databaseFile = path.resolve(process.env.DATABASE_FILE || path.join(__dirname, 'data', 'leads.db'));
const ipHashSecret = process.env.IP_HASH_SECRET || 'development-only-change-me';

fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
const db = new Database(databaseFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    whatsapp TEXT NOT NULL,
    email TEXT NOT NULL,
    utm_source TEXT,
    utm_campaign TEXT,
    ip_hash TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);
`);

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

const leadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intenta de nuevo más tarde.' }
});

const insertLead = db.prepare(`
  INSERT INTO leads (name, whatsapp, email, utm_source, utm_campaign, ip_hash, user_agent)
  VALUES (@name, @whatsapp, @email, @utmSource, @utmCampaign, @ipHash, @userAgent)
`);

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxLength) : '';
}

function hashIp(ip) {
  return crypto.createHmac('sha256', ipHashSecret).update(ip || 'unknown').digest('hex');
}

app.get('/health', (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.post('/api/leads', leadLimiter, (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const honeypot = cleanText(body.empresa_web ?? body.companyWebsite, 100);

  // Keep bot responses indistinguishable from a successful submission.
  if (honeypot) return res.status(201).json({ ok: true });

  const name = cleanText(body.nombre ?? body.name, 120);
  const whatsapp = cleanText(body.whatsapp, 30).replace(/\D/g, '');
  const email = cleanText(body.email, 254).toLowerCase();
  const utmSource = cleanText(body.utmSource ?? body.utm_source, 100);
  const utmCampaign = cleanText(body.utmCampaign ?? body.utm_campaign, 150);

  if (!name || !whatsapp || !email) return res.status(400).json({ error: 'Completa todos los campos.' });
  if (name.length < 2) return res.status(400).json({ error: 'El nombre no es válido.' });
  if (whatsapp.length < 10 || whatsapp.length > 15) return res.status(400).json({ error: 'El WhatsApp no es válido.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'El correo no es válido.' });

  try {
    insertLead.run({
      name,
      whatsapp,
      email,
      utmSource: utmSource || null,
      utmCampaign: utmCampaign || null,
      ipHash: hashIp(req.ip),
      userAgent: cleanText(req.get('user-agent'), 500) || null
    });
    return res.status(201).json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'No se pudo guardar la solicitud. Intenta de nuevo.' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*splat', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Lead capture server listening on 0.0.0.0:${port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
