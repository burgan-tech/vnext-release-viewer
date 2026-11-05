const zlib = require('zlib');
const { promisify } = require('util');

const gunzip = promisify(zlib.gunzip);
const LISTED_STATUSES = new Set(['deployed', 'failed']);

// Helm secret storage: data.release = base64(k8s) → base64(helm) → gzip → JSON
async function decodeRelease(b64) {
  const helmEncoded = Buffer.from(b64, 'base64').toString('utf8');
  let buf = Buffer.from(helmEncoded, 'base64');
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = await gunzip(buf);
  return JSON.parse(buf.toString('utf8'));
}

/**
 * `helm list -A --max 0` eşdeğeri (her release'in son revizyonu, deployed/failed).
 * helm list tüm revizyon secret'larını (release başına 10'a kadar) indirip açar; burada label selector ile
 * yalnızca superseded olmayan revizyonlar okunur → çok daha az veri ve bellek.
 * Dönen nesneler helm list JSON şeklindedir (+ info.first_deployed / info.last_deployed).
 */
async function listHelmReleases(runKubectl) {
  const result = await runKubectl([
    'get', 'secrets', '-A',
    '-l', 'owner=helm,status!=superseded',
    '--field-selector', 'type=helm.sh/release.v1',
    '--request-timeout=60s',
    '-o', 'json',
  ]);
  if (result.code !== 0 || result.signal) {
    let detail = (result.stderr || result.stdout || '').trim();
    if (!detail && result.signal) detail = `Process killed (signal: ${result.signal}).`;
    throw new Error(detail || `kubectl exit code ${result.code}`);
  }
  const items = JSON.parse(result.stdout || '{}').items || [];

  const latest = new Map();
  for (const s of items) {
    const labels = s.metadata?.labels || {};
    const ns = s.metadata?.namespace;
    const data = s.data?.release;
    if (!labels.name || !ns || !data) continue;
    const rev = parseInt(labels.version, 10) || 0;
    const key = `${ns}/${labels.name}`;
    const cur = latest.get(key);
    if (!cur || rev > cur.rev) latest.set(key, { rev, data });
  }

  const decoded = await Promise.all(
    [...latest.values()].map(({ data }) => decodeRelease(data).catch(() => null)),
  );

  return decoded
    .filter((r) => r && LISTED_STATUSES.has(r.info?.status))
    .map((r) => {
      const md = r.chart?.metadata || {};
      return {
        name: r.name,
        namespace: r.namespace,
        revision: r.version,
        status: r.info.status,
        chart: md.name && md.version ? `${md.name}-${md.version}` : (md.name || ''),
        app_version: md.appVersion || '',
        info: { first_deployed: r.info.first_deployed, last_deployed: r.info.last_deployed },
      };
    });
}

module.exports = { listHelmReleases };
