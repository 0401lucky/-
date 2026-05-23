// scripts/build-cloudflare.mjs
// 构建前临时移除仍由 R2 提供的大体积卡牌素材，保留新版页面静态素材

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const PUBLIC_IMAGES_DIR = "public/images";
const TMP_ROOT = ".images-r2-tmp";
const R2_IMAGE_DIRS = ["动物2", "动物卡", "塔罗"];

const movedDirs = [];

function moveAway() {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TMP_ROOT, { recursive: true });

  for (const dir of R2_IMAGE_DIRS) {
    const source = path.join(PUBLIC_IMAGES_DIR, dir);
    const target = path.join(TMP_ROOT, dir);
    if (!fs.existsSync(source)) {
      continue;
    }

    console.log(`[build-cf] 临时移除 public/images/${dir}（由 R2 提供服务）`);
    fs.renameSync(source, target);
    movedDirs.push({ source, target });
  }
}

function moveBack() {
  for (const { source, target } of movedDirs.reverse()) {
    if (fs.existsSync(target)) {
      fs.renameSync(target, source);
      console.log(`[build-cf] 已恢复 ${source}`);
    }
  }

  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
}

try {
  moveAway();
  execSync("npx opennextjs-cloudflare build", {
    stdio: "inherit",
  });
} finally {
  moveBack();
}
