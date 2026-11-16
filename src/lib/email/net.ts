import { BlockList, isIP } from "node:net";
import { lookup } from "node:dns/promises";

/**
 * Mail hosts are typed in by users, so the server must never connect to internal addresses (SSRF): localhost, private
 * networks, link-local (cloud metadata at 169.254.169.254) and similar. Every address a name resolves to must be public,
 * and the connection then goes to that checked IP (with the name kept for TLS), so a name cannot change its answer later.
 */
const blocked = new BlockList();
for (const [net, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as [string, number][]) blocked.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as [string, number][]) blocked.addSubnet(net, bits, "ipv6");

export function isPublicIp(ip: string): boolean {
  const v = isIP(ip);
  if (!v) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);            // IPv4-mapped IPv6: judge the embedded IPv4
  if (mapped) return isPublicIp(mapped[1]);
  return !blocked.check(ip, v === 4 ? "ipv4" : "ipv6");
}

export type Resolver = (host: string) => Promise<{ address: string }[]>;
const defaultResolver: Resolver = (h) => lookup(h, { all: true });
export type Target = { ip: string; servername: string };

export async function resolvePublic(host: string, resolver: Resolver = defaultResolver, allowPrivate = false): Promise<Target> {
  const name = host.trim().toLowerCase();
  if (!name || name.length > 253 || /[^a-z0-9.:\-]/.test(name)) throw new Error("That mail server name is not valid");
  if (/^(localhost|.*\.local|.*\.internal|.*\.localdomain)$/.test(name)) throw new Error("That mail server address is not allowed");
  const addrs = isIP(name) ? [{ address: name }] : await resolver(name).catch(() => { throw new Error(`Could not find the mail server ${name}`); });
  if (!addrs.length) throw new Error(`Could not find the mail server ${name}`);
  if (!allowPrivate && addrs.some((a) => !isPublicIp(a.address))) throw new Error("That mail server address is not allowed");
  return { ip: addrs[0].address, servername: name };
}
