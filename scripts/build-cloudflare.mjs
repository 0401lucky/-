// scripts/build-cloudflare.mjs
// 构建前临时移除 public/images（现在从 R2 提供服务），构建后恢复

import fs from "node:fs";
import { execSync } from "node:child_process";

const IMG_SRC = "public/images";
const IMG_TMP = ".images-tmp";

function moveAway() {
  if (fs.existsSync(IMG_SRC)) {
    console.log("[build-cf] 临时移除 public/images（图片现在从 R2 提供服务）");
    fs.renameSync(IMG_SRC, IMG_TMP);
  }
}

function moveBack() {
  if (fs.existsSync(IMG_TMP)) {
    fs.renameSync(IMG_TMP, IMG_SRC);
    console.log("[build-cf] 已恢复 public/images");
  }
}

try {
  moveAway();
  execSync("npx opennextjs-cloudflare build", {
    stdio: "inherit",
  });
} finally {
  moveBack();
}
