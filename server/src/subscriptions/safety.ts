import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Protección contra SSRF: un webhook no puede apuntar a la red interna del
 * servidor. Se valida al crear la suscripción y otra vez en cada envío, porque el
 * DNS de un dominio puede cambiar después (DNS rebinding).
 */

export type Resolver = (host: string) => Promise<string[]>;

export const systemResolver: Resolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((r) => r.address);

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const PRIVATE_V4: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

export function isPrivateAddress(ip: string): boolean {
  const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  if (isIP(ip) === 4) {
    const n = ipv4ToInt(ip);
    return PRIVATE_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    return v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith('ff');
  }
  return true; // lo que no se entiende, no se permite
}

export class UnsafeUrlError extends Error {}

export type UrlPolicy = {
  /** Permite http:// y direcciones privadas (solo para desarrollo local). */
  allowPrivate: boolean;
  resolve: Resolver;
};

/** Valida la URL y que todas sus direcciones sean públicas. Devuelve la URL normalizada. */
export async function assertSafeWebhookUrl(raw: string, policy: UrlPolicy): Promise<string> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('La URL del webhook no es válida.');
  }
  if (url.username || url.password) throw new UnsafeUrlError('La URL no puede incluir usuario ni contraseña.');
  if (url.protocol !== 'https:' && !(policy.allowPrivate && url.protocol === 'http:')) {
    throw new UnsafeUrlError('El webhook debe usar https.');
  }
  if (policy.allowPrivate) return url.toString();

  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await policy.resolve(host);
  } catch {
    throw new UnsafeUrlError(`No se pudo resolver ${host}.`);
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new UnsafeUrlError('El webhook debe apuntar a una dirección pública.');
  }
  return url.toString();
}
