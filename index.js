// ECS Lab App - every feature here maps to a part of the ECS task definition.
//   PORT, APP_ENV, APP_COLOR, APP_VERSION  -> "Environment variables"
//   SECRET_MESSAGE                          -> "Secrets" (Secrets Manager / Parameter Store)
//   GET /health                             -> "HealthCheck"
//   console.log on every request            -> "Log configuration" (CloudWatch awslogs)
//   /data/visits.txt                        -> "Volumes" + "Mount points"
//   ECS_CONTAINER_METADATA_URI_V4           -> injected by the ECS agent (task ARN, AZ, limits)
//   SIGTERM handler                         -> "Stop timeout"

const express = require('express');
const os = require('os');
const fs = require('fs');
const path = require('path');

const app = express();

const PORT = parseInt(process.env.PORT || '3000', 10);
const APP_ENV = process.env.APP_ENV || 'local';
const APP_COLOR = process.env.APP_COLOR || '#2563eb';
const APP_VERSION = process.env.APP_VERSION || 'v1';
const SECRET_MESSAGE = process.env.SECRET_MESSAGE || '';
const DATA_DIR = process.env.DATA_DIR || '/data';
const VISITS_FILE = path.join(DATA_DIR, 'visits.txt');
const STARTED_AT = new Date();

function containerIp() {
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const d of iface) {
      if (d.family === 'IPv4' && !d.internal) return d.address;
    }
  }
  return 'unknown';
}

function bumpVisits() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    let n = 0;
    if (fs.existsSync(VISITS_FILE)) n = parseInt(fs.readFileSync(VISITS_FILE, 'utf8'), 10) || 0;
    n += 1;
    fs.writeFileSync(VISITS_FILE, String(n));
    return { count: n, persisted: true };
  } catch (err) {
    return { count: null, persisted: false, error: err.code || err.message };
  }
}

async function ecsMetadata() {
  const uri = process.env.ECS_CONTAINER_METADATA_URI_V4;
  if (!uri) return null;
  try {
    const res = await fetch(`${uri}/task`, { signal: AbortSignal.timeout(1500) });
    const t = await res.json();
    return {
      cluster: t.Cluster,
      taskArn: t.TaskARN,
      family: `${t.Family}:${t.Revision}`,
      launchType: t.LaunchType || 'EC2',
      az: t.AvailabilityZone,
      limits: t.Limits,
    };
  } catch (err) {
    return { error: err.message };
  }
}

function mask(s) {
  if (!s) return 'NOT SET';
  if (s.length <= 4) return '****';
  return `${s.slice(0, 2)}${'*'.repeat(Math.min(s.length - 4, 12))}${s.slice(-2)} (${s.length} chars)`;
}

function esc(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Log every request to stdout -> appears in CloudWatch Logs
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path !== '/health') {
      console.log(JSON.stringify({ time: new Date().toISOString(), method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start }));
    }
  });
  next();
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
});

app.get('/api/info', async (req, res) => {
  res.json({
    hostname: os.hostname(),
    containerIp: containerIp(),
    env: APP_ENV,
    color: APP_COLOR,
    version: APP_VERSION,
    secret: mask(SECRET_MESSAGE),
    visits: bumpVisits(),
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    startedAt: STARTED_AT.toISOString(),
    ecs: await ecsMetadata(),
  });
});

app.get('/', async (req, res) => {
  const visits = bumpVisits();
  const meta = await ecsMetadata();
  const rows = [
    ['Hostname (container ID)', os.hostname()],
    ['Container IP', containerIp()],
    ['APP_ENV', APP_ENV],
    ['APP_VERSION', APP_VERSION],
    ['SECRET_MESSAGE', mask(SECRET_MESSAGE)],
    ['Visits (from /data volume)', visits.persisted ? visits.count : `not saved (${visits.error})`],
    ['Started at', STARTED_AT.toISOString()],
    ['Running on ECS', meta ? 'yes' : 'no (local Docker)'],
  ];
  if (meta && !meta.error) {
    rows.push(['Task definition', meta.family], ['Launch type', meta.launchType], ['Availability zone', meta.az],
      ['Task ARN', meta.taskArn], ['Limits', JSON.stringify(meta.limits)]);
  }
  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ECS Lab App</title>
<style>
  body{font-family:Arial,sans-serif;margin:0;background:#f5f6f8;color:#1f2328}
  header{background:${esc(APP_COLOR)};color:#fff;padding:24px 16px;text-align:center}
  h1{margin:0;font-size:26px} header p{margin:6px 0 0;opacity:.9}
  table{border-collapse:collapse;margin:24px auto;width:min(720px,94%);background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.1)}
  td{padding:10px 14px;border-bottom:1px solid #e5e7eb;font-size:14px;word-break:break-all}
  td:first-child{font-weight:bold;width:38%;word-break:normal}
  footer{text-align:center;color:#57606a;font-size:13px;padding-bottom:24px}
</style></head>
<body>
<header><h1>ECS Lab App</h1><p>${esc(APP_ENV)} &middot; ${esc(APP_VERSION)}</p></header>
<table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
<footer>Refresh to see the visit counter. JSON: <code>/api/info</code> &middot; Health: <code>/health</code></footer>
</body></html>`);
});

const server = app.listen(PORT, () => {
  console.log(`ECS Lab App ${APP_VERSION} (${APP_ENV}) listening on port ${PORT}`);
  console.log(`Secret configured: ${SECRET_MESSAGE ? 'yes' : 'no'}`);
});

// ECS sends SIGTERM when a task stops, then SIGKILL after "stopTimeout" seconds
process.on('SIGTERM', () => {
  console.log('SIGTERM received - finishing requests and shutting down');
  server.close(() => {
    console.log('Shutdown complete');
    process.exit(0);
  });
});
