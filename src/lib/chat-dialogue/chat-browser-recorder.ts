import { execFile as execFileCallback, spawn, type ChildProcess } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { sha256File, writeJson } from "../fs-utils.ts";
import type { ChatRuntimeTimeline } from "./chat-runtime-timeline.ts";

const execFileAsync = promisify(execFileCallback);
const BROWSER_RENDER_EVIDENCE_PATH = "data/chains/chat_dialogue_mv/browser_render_evidence.json";
const CDP_COMMAND_TIMEOUT_MS = 5000;

export type RenderChatRuntimeToVisualInput = {
  projectRoot: string;
  runtimeHtmlPath: string;
  runtimeTimeline: ChatRuntimeTimeline;
  outputPath: string;
  renderRoot?: string;
  chromeExecutable?: string;
  width?: number;
  height?: number;
  fps?: number;
  keepFrames?: boolean;
};

export type ChatBrowserRenderEvidence = {
  schema_version: 1;
  chain_id: "chat_dialogue_mv";
  render_mode: "browser_recording";
  runtime_html_path: string;
  output_path: string;
  fps: number;
  width: number;
  height: number;
  duration_sec: number;
  frame_count: number;
  visual_sha256: string;
  capture_strategy: "cdp_seek_screenshots";
  chrome_executable: string;
};

export type CaptureRuntimeScreenshotsInput = {
  runtimeHtmlAbsolutePath: string;
  renderRoot: string;
  chromeExecutable: string;
  width: number;
  height: number;
  fps: number;
  frameCount: number;
};

export type ChatBrowserRecorderDeps = {
  captureScreenshots?: (input: CaptureRuntimeScreenshotsInput) => Promise<{ chromeExecutable: string }>;
  execFile?: typeof execFileAsync;
  sha256File?: typeof sha256File;
};

export async function renderChatRuntimeToVisual(
  input: RenderChatRuntimeToVisualInput,
  deps: ChatBrowserRecorderDeps = {},
): Promise<ChatBrowserRenderEvidence> {
  const width = input.width ?? input.runtimeTimeline.width;
  const height = input.height ?? input.runtimeTimeline.height;
  const fps = input.fps ?? input.runtimeTimeline.fps;
  const frameCount = frameCountForTimeline(input.runtimeTimeline, fps);
  const runtimeHtmlAbsolutePath = resolveProjectPath(input.projectRoot, input.runtimeHtmlPath);
  const outputAbsolutePath = resolveProjectPath(input.projectRoot, input.outputPath);
  const renderRoot = input.renderRoot ?? path.join(input.projectRoot, "data/chains/chat_dialogue_mv/browser_render_frames");
  const chromeExecutable = input.chromeExecutable ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? "google-chrome";
  const ownsRenderRoot = input.renderRoot === undefined;

  if (ownsRenderRoot) await rm(renderRoot, { recursive: true, force: true });
  await mkdir(renderRoot, { recursive: true });
  await mkdir(path.dirname(outputAbsolutePath), { recursive: true });
  await (deps.captureScreenshots ?? captureRuntimeScreenshots)({
    runtimeHtmlAbsolutePath,
    renderRoot,
    chromeExecutable,
    width,
    height,
    fps,
    frameCount,
  });

  await (deps.execFile ?? execFileAsync)("ffmpeg", ffmpegImageSequenceArgs({
    renderRoot,
    fps,
    outputPath: outputAbsolutePath,
  }), { maxBuffer: 20 * 1024 * 1024 });

  const evidence: ChatBrowserRenderEvidence = {
    schema_version: 1,
    chain_id: "chat_dialogue_mv",
    render_mode: "browser_recording",
    runtime_html_path: projectRelative(input.projectRoot, runtimeHtmlAbsolutePath),
    output_path: projectRelative(input.projectRoot, outputAbsolutePath),
    fps,
    width,
    height,
    duration_sec: input.runtimeTimeline.duration_sec,
    frame_count: frameCount,
    visual_sha256: await (deps.sha256File ?? sha256File)(outputAbsolutePath),
    capture_strategy: "cdp_seek_screenshots",
    chrome_executable: chromeExecutable,
  };
  await writeJson(path.join(input.projectRoot, BROWSER_RENDER_EVIDENCE_PATH), evidence);
  if (ownsRenderRoot && !input.keepFrames) await rm(renderRoot, { recursive: true, force: true });
  return evidence;
}

export function frameCountForTimeline(timeline: Pick<ChatRuntimeTimeline, "duration_sec">, fps: number): number {
  if (!Number.isFinite(timeline.duration_sec) || timeline.duration_sec <= 0) throw new Error("runtime timeline duration must be positive");
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("runtime recorder fps must be positive");
  return Math.ceil(timeline.duration_sec * fps);
}

export function chromeRuntimeRecordingArgs(input: {
  remoteDebuggingPort: number;
  runtimeHtmlAbsolutePath: string;
  width: number;
  height: number;
}): string[] {
  return [
    "--headless=new",
    `--remote-debugging-port=${input.remoteDebuggingPort}`,
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--hide-scrollbars",
    `--window-size=${input.width},${input.height}`,
    pathToFileURL(input.runtimeHtmlAbsolutePath).href,
  ];
}

export function ffmpegImageSequenceArgs(input: {
  renderRoot: string;
  fps: number;
  outputPath: string;
}): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-framerate",
    String(input.fps),
    "-i",
    path.join(input.renderRoot, "frame_%06d.png"),
    "-vf",
    `fps=${input.fps},format=yuv420p`,
    "-movflags",
    "+faststart",
    input.outputPath,
  ];
}

async function captureRuntimeScreenshots(input: CaptureRuntimeScreenshotsInput): Promise<{ chromeExecutable: string }> {
  const port = await freePort();
  const chrome = spawn(input.chromeExecutable, chromeRuntimeRecordingArgs({
    remoteDebuggingPort: port,
    runtimeHtmlAbsolutePath: input.runtimeHtmlAbsolutePath,
    width: input.width,
    height: input.height,
  }), { stdio: "ignore" });
  let cdp: CdpSession | undefined;
  try {
    const wsUrl = await waitForPageWebSocketUrl(port);
    cdp = await CdpSession.connect(wsUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: input.width,
      height: input.height,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await cdp.send("Runtime.evaluate", {
      expression: "window.__qivanceChatRuntime.ready",
      awaitPromise: true,
    });
    for (let index = 0; index < input.frameCount; index += 1) {
      await cdp.send("Runtime.evaluate", {
        expression: `window.__qivanceChatRuntime.seek(${index / input.fps})`,
        awaitPromise: false,
      });
      const screenshot = await captureScreenshotWithUnpausedVirtualTime(cdp);
      await writeFile(path.join(input.renderRoot, `frame_${String(index + 1).padStart(6, "0")}.png`), screenshot.data, "base64");
    }
    await assertRuntimeMessagesVisible(cdp);
    return { chromeExecutable: input.chromeExecutable };
  } finally {
    cdp?.close();
    killChrome(chrome);
  }
}

type CdpCommandSender = {
  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T>;
};

export async function captureScreenshotWithUnpausedVirtualTime(cdp: CdpCommandSender): Promise<{ data: string }> {
  return cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png", fromSurface: true });
}

async function assertRuntimeMessagesVisible(cdp: CdpCommandSender): Promise<void> {
  const result = await cdp.send<{ result?: { value?: string } }>("Runtime.evaluate", {
    expression: `JSON.stringify({
      total: document.querySelectorAll("[data-message-id]").length,
      visible: document.querySelectorAll(".row:not(.is-hidden)").length
    })`,
    returnByValue: true,
  });
  const value = JSON.parse(result.result?.value ?? "{}") as { total?: number; visible?: number };
  if ((value.total ?? 0) > 0 && (value.visible ?? 0) === 0) {
    throw new Error("chat_browser_recording_empty: runtime playback captured no visible message rows");
  }
}

function resolveProjectPath(projectRoot: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);
}

function projectRelative(projectRoot: string, filePath: string): string {
  return path.relative(projectRoot, filePath).split(path.sep).join("/");
}

function killChrome(chrome: ChildProcess): void {
  if (!chrome.killed) chrome.kill("SIGTERM");
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === "string") reject(new Error("could not allocate a local port"));
        else resolve(address.port);
      });
    });
  });
}

async function waitForPageWebSocketUrl(port: number): Promise<string> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const pages = await httpJson<Array<{ type?: string; webSocketDebuggerUrl?: string }>>(`http://127.0.0.1:${port}/json`);
      const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl) ?? pages.find((item) => item.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome may still be starting.
    }
    await wait(100);
  }
  throw new Error("browser recorder could not connect to Chrome DevTools Protocol");
}

function httpJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on("end", () => {
        if (!response.statusCode || response.statusCode >= 400) {
          reject(new Error(`HTTP ${response.statusCode ?? 0} from ${url}`));
          return;
        }
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
      });
    }).on("error", reject);
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), ms);
    timeout.unref?.();
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

type WebSocketLike = {
  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: { data?: unknown; error?: unknown }) => void, options?: { once?: boolean }): void;
  send(data: string): void;
  close(): void;
};

type WebSocketConstructor = new (url: string) => WebSocketLike;

class CdpSession {
  private id = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly socket: WebSocketLike;

  private constructor(socket: WebSocketLike) {
    this.socket = socket;
    socket.addEventListener("message", (event) => this.handleMessage(event.data));
    socket.addEventListener("close", () => this.rejectAll(new Error("Chrome DevTools connection closed")));
    socket.addEventListener("error", () => this.rejectAll(new Error("Chrome DevTools connection failed")));
  }

  static async connect(url: string): Promise<CdpSession> {
    const Ctor = webSocketConstructor();
    const socket = new Ctor(url);
    await withTimeout(new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("Chrome DevTools WebSocket failed to open")), { once: true });
    }), CDP_COMMAND_TIMEOUT_MS, "chat_browser_recording_stalled: Chrome DevTools WebSocket did not open");
    return new CdpSession(socket);
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.id;
    this.id += 1;
    this.socket.send(JSON.stringify({ id, method, params }));
    const response = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
    });
    return withTimeout(
      response,
      CDP_COMMAND_TIMEOUT_MS,
      `chat_browser_recording_stalled: Chrome DevTools command timed out: ${method}`,
    ).catch((error) => {
      this.pending.delete(id);
      throw error;
    });
  }

  close(): void {
    this.socket.close();
  }

  private handleMessage(data: unknown): void {
    const message = JSON.parse(messageText(data)) as {
      id?: number;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: { message?: string };
    };
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? "Chrome DevTools command failed"));
      else pending.resolve(message.result ?? {});
      return;
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

function webSocketConstructor(): WebSocketConstructor {
  const ctor = (globalThis as unknown as { WebSocket?: WebSocketConstructor }).WebSocket;
  if (!ctor) throw new Error("global WebSocket is required for browser recorder CDP connection");
  return ctor;
}

function messageText(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  return String(data);
}
