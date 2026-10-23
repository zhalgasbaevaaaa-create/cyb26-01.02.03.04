// SSRF және зиянды URL-дерден қорғау.
// Ережелер: тек http/https; localhost/loopback/private/link-local/metadata тыйым;
// DNS аты шешіліп, барлық IP-лер тексеріледі; әр редирект қайта тексеріледі.

import { promises as dns } from "node:dns";
import { isIP } from "node:net";

export interface UrlCheckResult {
  ok: boolean;
  reason?: string;      // Қазақша себеп (пайдаланушыға көрсетіледі)
  finalUrl?: string;
  resolvedIps?: string[];
}

export interface UrlCheckOptions {
  /** Тек сынақ fixture-і үшін: localhost-қа рұқсат (өндірісте ЕШҚАШАН қоспаңыз). */
  allowLocalhostForTests?: boolean;
  /** Сыртқы DNS қолжетімсіз ортада IP тексеруін өткізу (тек тестілерде). */
  skipDns?: boolean;
}

export function isPrivateIp(ip: string): boolean {
  // IPv4-mapped IPv6
  const v4mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  const addr = v4mapped ? v4mapped[1] : ip;

  if (isIP(addr) === 4) {
    const [a, b] = addr.split(".").map(Number);
    if (a === 0) return true;                          // 0.0.0.0/8
    if (a === 10) return true;                         // 10.0.0.0/8
    if (a === 127) return true;                        // loopback
    if (a === 169 && b === 254) return true;           // link-local + cloud metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
    if (a === 192 && b === 168) return true;           // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a === 192 && b === 0) return true;             // 192.0.0.0/24, 192.0.2.0/24 (test-net)
    if (a >= 224) return true;                         // multicast + reserved
    return false;
  }
  if (isIP(addr) === 6) {
    const lower = addr.toLowerCase();
    if (lower === "::" || lower === "::1") return true;               // loopback
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // link-local
    if (lower.startsWith("::ffff:")) return isPrivateIp(lower.slice(7));
    return false;
  }
  return true; // IP емес немесе танылмаған формат — қауіпсіздік үшін бұғаттау
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
  "instance-data",
]);

/** Синхронды бөлігі: схема, hostname форматтық тексерулері. */
export function validateUrlFormat(raw: string, opts: UrlCheckOptions = {}): UrlCheckResult {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "Жарамсыз сілтеме: URL форматы бұзылған." };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "Тек http:// немесе https:// сілтемелері рұқсат етіледі." };
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return { ok: false, reason: "Сілтемеде хост аты жоқ." };
  const isLoopbackHost =
    host === "localhost" || host.endsWith(".localhost") || (isIP(host) === 4 && host.startsWith("127.")) || host === "::1" || host === "[::1]";
  // Fixture режимі тек loopback-қа рұқсат береді; басқа жеке/метадерек мекенжайдар бәрібір тыйым.
  if (!(opts.allowLocalhostForTests && isLoopbackHost)) {
    if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
      return { ok: false, reason: "Ішкі желі мекенжайларына сұраныс жасауға тыйым салынған (SSRF қорғанысы)." };
    }
    if (isIP(host) && isPrivateIp(host)) {
      return { ok: false, reason: "Жеке/ішкі IP мекенжайлары бұғатталған (SSRF қорғанысы)." };
    }
  }
  // Пайдаланушы аты/пароль URL-де болмауы керек
  if (u.username || u.password) {
    return { ok: false, reason: "Сілтемеде пайдаланушы аты/пароль болмауы керек." };
  }
  return { ok: true, finalUrl: u.toString() };
}

/** Толық тексеру: формат + DNS шешу + барлық IP-ді тексеру. */
export async function validateUrl(raw: string, opts: UrlCheckOptions = {}): Promise<UrlCheckResult> {
  const fmt = validateUrlFormat(raw, opts);
  if (!fmt.ok || !fmt.finalUrl) return fmt;
  const u = new URL(fmt.finalUrl);
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  const isLoopbackHost =
    host === "localhost" || host.endsWith(".localhost") || (isIP(host) === 4 && host.startsWith("127.")) || host === "::1" || host === "[::1]";
  if (opts.allowLocalhostForTests && isLoopbackHost) {
    return { ok: true, finalUrl: fmt.finalUrl, resolvedIps: [host] };
  }
  if (isIP(host)) {
    // IP тікелей берілген — форматтық тексеру жеткілікті
    return { ok: true, finalUrl: fmt.finalUrl, resolvedIps: [host] };
  }
  if (opts.skipDns) {
    return { ok: true, finalUrl: fmt.finalUrl };
  }
  try {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    const ips = records.map((r) => r.address);
    if (ips.length === 0) {
      return { ok: false, reason: "Домен аты шешілмеді (DNS жауап бермеді)." };
    }
    const bad = ips.filter((ip) => isPrivateIp(ip));
    if (bad.length > 0) {
      return { ok: false, reason: "Домен жеке/ішкі мекенжайға апарады — сұраныс бұғатталды (SSRF қорғанысы)." };
    }
    return { ok: true, finalUrl: fmt.finalUrl, resolvedIps: ips };
  } catch {
    return { ok: false, reason: "Домен атын шешу мүмкін болмады (DNS қатесі)." };
  }
}

/**
 * Playwright route-интерцепторында қолданылатын тексеру:
 * әр желілік сұраныстың хостын тексереді (редиректтерді қоса).
 */
export function isRequestHostAllowed(hostname: string, opts: UrlCheckOptions = {}): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return false;
  // Бұлт метадеректер нүктелері ЕШҚАШАН рұқсат етілмейді (тіпті сынақ режимінде де)
  if (host === "metadata.google.internal" || host === "metadata" || host === "instance-data") return false;
  if (isIP(host) && host === "169.254.169.254") return false;

  const isLocal =
    host === "localhost" || host.endsWith(".localhost") || (isIP(host) === 4 && host.startsWith("127.")) || host === "::1" || host === "[::1]";

  if (opts.allowLocalhostForTests && isLocal) return true;
  if (isLocal) return false;

  if (isIP(host)) return !isPrivateIp(host);
  if (host.endsWith(".local") || host.endsWith(".internal")) return false;
  return true; // домен атауы — DNS тексеруі validateUrl-де орындалды
}
