import type { NetworkInterfaceInfo } from "node:os";

export type NetworkInterfaceMap = Record<string, NetworkInterfaceInfo[] | undefined>;

export function formatStartupMessage(input: {
  host: string;
  port: number;
  interfaces: NetworkInterfaceMap;
}): string {
  const host = input.host.trim() || "0.0.0.0";
  const lines = [
    "Qivance Music local MVP:",
    `  Bind: HOST=${host} PORT=${input.port}`,
    `  Local: http://127.0.0.1:${input.port}/projects`,
  ];

  if (isLoopbackHost(host)) {
    lines.push(`  LAN: disabled because HOST=${host} only listens on this machine`);
    return lines.join("\n");
  }

  if (!isWildcardHost(host)) {
    lines.push(`  LAN: http://${formatUrlHost(host)}:${input.port}/projects`);
    return lines.join("\n");
  }

  const lanUrls = currentLanUrls(input.interfaces, input.port);
  if (lanUrls.length === 0) {
    lines.push("  LAN: no non-internal IPv4 address detected");
  } else {
    lines.push(...lanUrls.map((url) => `  LAN: ${url}`));
  }
  lines.push("  LAN IPs are current at startup; restart or recheck after network changes.");
  return lines.join("\n");
}

function currentLanUrls(interfaces: NetworkInterfaceMap, port: number): string[] {
  const seenAddresses = new Set<string>();
  const urls: string[] = [];
  for (const [name, entries] of Object.entries(interfaces).sort(([a], [b]) => a.localeCompare(b))) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal || !isPrivateLanAddress(entry.address) || seenAddresses.has(entry.address)) {
        continue;
      }
      seenAddresses.add(entry.address);
      urls.push(`http://${entry.address}:${port}/projects (${name})`);
    }
  }
  return urls;
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function isWildcardHost(host: string): boolean {
  return host === "0.0.0.0" || host === "::";
}

function formatUrlHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function isPrivateLanAddress(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [first, second] = parts;
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}
