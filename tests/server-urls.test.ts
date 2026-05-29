import assert from "node:assert/strict";
import type { NetworkInterfaceInfo } from "node:os";
import test from "node:test";
import { formatStartupMessage } from "../src/lib/server-urls.ts";

const lanInterface: NetworkInterfaceInfo = {
  address: "172.20.10.11",
  netmask: "255.255.255.0",
  family: "IPv4",
  mac: "00:00:00:00:00:00",
  internal: false,
  cidr: "172.20.10.11/24",
};

const loopbackInterface: NetworkInterfaceInfo = {
  address: "127.0.0.1",
  netmask: "255.0.0.0",
  family: "IPv4",
  mac: "00:00:00:00:00:00",
  internal: true,
  cidr: "127.0.0.1/8",
};

const proxyInterface: NetworkInterfaceInfo = {
  address: "198.18.0.1",
  netmask: "255.255.255.0",
  family: "IPv4",
  mac: "00:00:00:00:00:00",
  internal: false,
  cidr: "198.18.0.1/24",
};

const tailscaleInterface: NetworkInterfaceInfo = {
  address: "100.68.59.7",
  netmask: "255.255.255.0",
  family: "IPv4",
  mac: "00:00:00:00:00:00",
  internal: false,
  cidr: "100.68.59.7/24",
};

test("startup message lists current LAN IPv4 URLs for wildcard hosts", () => {
  assert.equal(
    formatStartupMessage({
      host: "0.0.0.0",
      port: 3000,
      interfaces: {
        lo: [loopbackInterface],
        Mihomo: [proxyInterface],
        Tailscale: [tailscaleInterface],
        WLAN: [lanInterface],
      },
    }),
    [
      "Qivance Music local MVP:",
      "  Bind: HOST=0.0.0.0 PORT=3000",
      "  Local: http://127.0.0.1:3000/projects",
      "  LAN: http://172.20.10.11:3000/projects (WLAN)",
      "  LAN IPs are current at startup; restart or recheck after network changes.",
    ].join("\n"),
  );
});

test("startup message does not advertise LAN URLs for loopback-only hosts", () => {
  assert.equal(
    formatStartupMessage({
      host: "127.0.0.1",
      port: 3000,
      interfaces: {
        WLAN: [lanInterface],
      },
    }),
    [
      "Qivance Music local MVP:",
      "  Bind: HOST=127.0.0.1 PORT=3000",
      "  Local: http://127.0.0.1:3000/projects",
      "  LAN: disabled because HOST=127.0.0.1 only listens on this machine",
    ].join("\n"),
  );
});
