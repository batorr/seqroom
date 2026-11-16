// The address of the person behind a Socket.IO connection, for rate limits.
//
// On Render the app sits behind Render's proxy (and on seqroom.com also
// behind Cloudflare), so the connection's own address is the proxy's and
// would put every visitor in one shared bucket. Render's proxy appends the
// address that connected to it to X-Forwarded-For; when that address is one
// of Cloudflare's, Cloudflare's CF-Connecting-IP names the visitor.
//
// Headers are only trusted behind a proxy (Render sets RENDER, or set
// TRUST_PROXY=1): without one, any client could send them. CF-Connecting-IP
// is only believed when the request really came from Cloudflare, because the
// service is also reachable directly on its onrender.com address.

const { BlockList, isIP } = require('net');

// https://www.cloudflare.com/ips-v4 and /ips-v6 (fetched November 2026).
const CLOUDFLARE_V4 = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
];
const CLOUDFLARE_V6 = [
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
];

const cloudflare = new BlockList();
CLOUDFLARE_V4.forEach((cidr) => {
  const [net, prefix] = cidr.split('/');
  cloudflare.addSubnet(net, Number(prefix), 'ipv4');
});
CLOUDFLARE_V6.forEach((cidr) => {
  const [net, prefix] = cidr.split('/');
  cloudflare.addSubnet(net, Number(prefix), 'ipv6');
});

// Plain IPv4 for IPv4-mapped IPv6 ("::ffff:1.2.3.4"); '' for anything that
// is not an address.
function normalizeAddress(value) {
  const text = String(value || '').trim();
  const unmapped = text.toLowerCase().startsWith('::ffff:') && isIP(text.slice(7)) === 4 ? text.slice(7) : text;
  return isIP(unmapped) ? unmapped : '';
}

function isCloudflare(address) {
  const kind = isIP(address);
  return kind === 4 ? cloudflare.check(address, 'ipv4') : kind === 6 ? cloudflare.check(address, 'ipv6') : false;
}

// handshake: { headers, address } as on a Socket.IO handshake.
function clientAddress({ headers = {}, address = '' } = {}, { trustProxy = false } = {}) {
  const direct = normalizeAddress(address) || 'unknown';
  if (!trustProxy) {
    return direct;
  }
  const forwarded = String(headers['x-forwarded-for'] || '')
    .split(',')
    .map(normalizeAddress)
    .filter(Boolean);
  const peer = forwarded.length ? forwarded[forwarded.length - 1] : direct;
  const viaCloudflare = normalizeAddress(headers['cf-connecting-ip']);
  if (viaCloudflare && isCloudflare(peer)) {
    return viaCloudflare;
  }
  return peer;
}

function trustProxyFromEnv(env = process.env) {
  return env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true' || Boolean(env.RENDER);
}

module.exports = { clientAddress, trustProxyFromEnv, isCloudflare, normalizeAddress };
