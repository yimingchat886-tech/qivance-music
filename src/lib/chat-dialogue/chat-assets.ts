import { mkdir, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type ChatStandardProfileKey = "A" | "B" | "C";

export type ChatStandardUiProfile = {
  standard_profile: ChatStandardProfileKey;
  contact_name: string;
  contact_status: string;
  contact_avatar_src: string;
  left_avatar_src: string;
  right_avatar_src: string;
};

export const CHAT_STANDARD_UI_PROFILES: Record<ChatStandardProfileKey, ChatStandardUiProfile> = {
  A: {
    standard_profile: "A",
    contact_name: "蒲涛",
    contact_status: "在线",
    contact_avatar_src: "../assets/avatars/A.jpg",
    left_avatar_src: "../assets/avatars/A.jpg",
    right_avatar_src: "../assets/avatars/B.jpg",
  },
  B: {
    standard_profile: "B",
    contact_name: "林同学",
    contact_status: "今天在线",
    contact_avatar_src: "../assets/avatars/B.jpg",
    left_avatar_src: "../assets/avatars/B.jpg",
    right_avatar_src: "../assets/avatars/A.jpg",
  },
  C: {
    standard_profile: "C",
    contact_name: "秦老师",
    contact_status: "在线",
    contact_avatar_src: "../assets/avatars/C.svg",
    left_avatar_src: "../assets/avatars/C.svg",
    right_avatar_src: "../assets/avatars/A.jpg",
  },
};

const STATUS_ICON_ASSETS = [
  "back_arrow.png",
  "avatar_online.png",
  "online_dot.png",
  "video_camera.png",
  "more_ellipsis.png",
] as const;

const AVATAR_ASSETS = [
  { source: new URL("./assets/default_avatars/1.jpg", import.meta.url), fileName: "1.jpg" },
  { source: new URL("./assets/default_avatars/2.jpg", import.meta.url), fileName: "2.jpg" },
  { source: new URL("./assets/default_avatars/1.jpg", import.meta.url), fileName: "A.jpg" },
  { source: new URL("./assets/default_avatars/2.jpg", import.meta.url), fileName: "B.jpg" },
  { source: new URL("./assets/standard_avatars/C.svg", import.meta.url), fileName: "C.svg" },
] as const;

export async function stageChatUiAssets(projectDir: string): Promise<void> {
  const statusIconDir = path.join(projectDir, "assets/status_bar_icons");
  const avatarDir = path.join(projectDir, "assets/avatars");
  await Promise.all([
    mkdir(statusIconDir, { recursive: true }),
    mkdir(avatarDir, { recursive: true }),
  ]);
  await Promise.all([
    ...STATUS_ICON_ASSETS.map((fileName) => symlinkAsset(new URL(`./assets/status_bar_icons/${fileName}`, import.meta.url), path.join(statusIconDir, fileName))),
    ...AVATAR_ASSETS.map((asset) => symlinkAsset(asset.source, path.join(avatarDir, asset.fileName))),
  ]);
}

function symlinkAsset(sourceUrl: URL, destinationPath: string): Promise<void> {
  const sourcePath = fileURLToPath(sourceUrl);
  const target = path.relative(path.dirname(destinationPath), sourcePath);
  return rm(destinationPath, { force: true }).then(() => symlink(target, destinationPath));
}
