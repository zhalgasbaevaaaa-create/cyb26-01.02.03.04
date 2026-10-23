// SSRF қорғанысының тестілері
import { describe, it, expect } from "vitest";
import { isPrivateIp, validateUrlFormat, validateUrl, isRequestHostAllowed } from "../../shared/src/urlSecurity";

describe("жеке IP анықтау", () => {
  it("loopback бұғатталады", () => {
    for (const ip of ["127.0.0.1", "127.255.255.254", "::1"]) expect(isPrivateIp(ip)).toBe(true);
  });
  it("жеке диапазондар бұғатталады", () => {
    for (const ip of ["10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "fc00::1", "fd12::1", "fe80::1"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });
  it("ашық мекенжайдар рұқсат", () => {
    for (const ip of ["8.8.8.8", "93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
  it("172.15 және 172.32 жеке емес (шекараны тексеру)", () => {
    expect(isPrivateIp("172.15.0.1")).toBe(false);
    expect(isPrivateIp("172.32.0.1")).toBe(false);
  });
});

describe("URL форматтық тексеру", () => {
  it("http/https рұқсат", () => {
    expect(validateUrlFormat("https://example.com/game").ok).toBe(true);
    expect(validateUrlFormat("http://example.com/game").ok).toBe(true);
  });
  it("басқа схемалар тыйым", () => {
    for (const u of ["file:///etc/passwd", "ftp://example.com", "javascript:alert(1)", "data:text/html,x", "gopher://x"]) {
      const r = validateUrlFormat(u);
      expect(r.ok, u).toBe(false);
    }
  });
  it("localhost/ішкі хосттар тыйым", () => {
    for (const u of ["http://localhost:8787", "http://127.0.0.1:8787", "http://[::1]/", "http://metadata.google.internal/", "http://evil.local/", "http://192.168.1.5/", "http://169.254.169.254/latest/meta-data/"]) {
      const r = validateUrlFormat(u);
      expect(r.ok, u).toBe(false);
    }
  });
  it("fixture режимі localhost-қа рұқсат береді", () => {
    expect(validateUrlFormat("http://127.0.0.1:8787/fixture/", { allowLocalhostForTests: true }).ok).toBe(true);
    expect(validateUrlFormat("http://localhost:8787/fixture/", { allowLocalhostForTests: true }).ok).toBe(true);
  });
  it("fixture режимінде де метадеректер нүктесі тыйым", () => {
    expect(isRequestHostAllowed("metadata.google.internal", { allowLocalhostForTests: true })).toBe(false);
    expect(isRequestHostAllowed("169.254.169.254", { allowLocalhostForTests: true })).toBe(false);
  });
  it("URL-де пайдаланушы аты/пароль тыйым", () => {
    expect(validateUrlFormat("http://user:pass@example.com/").ok).toBe(false);
  });
  it("жарамсыз URL — қате", () => {
    expect(validateUrlFormat("кездейсоқ мәтін").ok).toBe(false);
  });
});

describe("толық validateUrl (DNS)", () => {
  it("жеке IP-ге апаратын URL бұғатталады (skipDns жоқ)", async () => {
    const r = await validateUrl("http://10.1.2.3/game");
    expect(r.ok).toBe(false);
  });
  it("ашық IP рұқсат (DNS керек емес)", async () => {
    const r = await validateUrl("http://93.184.216.34/game");
    expect(r.ok).toBe(true);
  });
  it("DNS шешілмейтін домен — түсінікті қате", async () => {
    const r = await validateUrl("https://gha-joq-domen-12345.invalid/game");
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
  });
});

describe("сұраныс хосты тексеру (редиректтер үшін)", () => {
  it("ішкі мекенжайдар бұғатталады", () => {
    for (const h of ["127.0.0.1", "localhost", "10.0.0.5", "192.168.0.1", "169.254.169.254", "metadata.google.internal", "something.internal", "foo.local"]) {
      expect(isRequestHostAllowed(h), h).toBe(false);
    }
  });
  it("ашық домендер рұқсат", () => {
    for (const h of ["example.com", "8.8.8.8", "game-hub.kz"]) {
      expect(isRequestHostAllowed(h), h).toBe(true);
    }
  });
  it("fixture режимі: localhost рұқсат, метадеректер тыйым", () => {
    expect(isRequestHostAllowed("127.0.0.1", { allowLocalhostForTests: true })).toBe(true);
    expect(isRequestHostAllowed("localhost", { allowLocalhostForTests: true })).toBe(true);
    expect(isRequestHostAllowed("169.254.169.254", { allowLocalhostForTests: true })).toBe(false);
  });
});
