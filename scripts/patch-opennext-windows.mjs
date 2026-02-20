import fs from "node:fs";
import path from "node:path";

const PATCH_MARKER = "OPENNEXT_WINDOWS_TMPDIR_FALLBACK";

function patchCreateMiddleware(filePath) {
  const original = fs.readFileSync(filePath, "utf8");
  if (original.includes(PATCH_MARKER)) {
    return false;
  }

  const target =
    '        buildHelper.copyOpenNextConfig(options.buildDir, outputPath, await buildHelper.isEdgeRuntime(config.middleware.override));';
  const replacement = `        // ${PATCH_MARKER}: Windows + 非 ASCII 路径下，.open-next/.build 可能缺失 config 文件
        const useEdgeConfig = await buildHelper.isEdgeRuntime(config.middleware.override);
        const configFileName = useEdgeConfig ? "open-next.config.edge.mjs" : "open-next.config.mjs";
        const configFromBuildDir = path.join(options.buildDir, configFileName);
        const configSourceDir = fs.existsSync(configFromBuildDir) ? options.buildDir : options.tempBuildDir;
        buildHelper.copyOpenNextConfig(configSourceDir, outputPath, useEdgeConfig);`;

  if (!original.includes(target)) {
    throw new Error(
      `未找到可替换片段: ${filePath}\nOpenNext 版本可能已变化，请更新补丁脚本。`
    );
  }

  fs.writeFileSync(filePath, original.replace(target, replacement), "utf8");
  return true;
}

function patchCreateServerBundle(filePath) {
  const original = fs.readFileSync(filePath, "utf8");
  if (original.includes(PATCH_MARKER)) {
    return false;
  }

  const target =
    "    buildHelper.copyOpenNextConfig(options.buildDir, outPackagePath, true);";
  const replacement = `    // ${PATCH_MARKER}: Windows + 非 ASCII 路径下，.open-next/.build 可能缺失 edge config
    const edgeConfigPath = path.join(options.buildDir, "open-next.config.edge.mjs");
    const configSourceDir = fs.existsSync(edgeConfigPath) ? options.buildDir : options.tempBuildDir;
    buildHelper.copyOpenNextConfig(configSourceDir, outPackagePath, true);`;

  if (!original.includes(target)) {
    throw new Error(
      `未找到可替换片段: ${filePath}\nOpenNext 版本可能已变化，请更新补丁脚本。`
    );
  }

  fs.writeFileSync(filePath, original.replace(target, replacement), "utf8");
  return true;
}

function run() {
  const middlewareFile = path.join(
    process.cwd(),
    "node_modules",
    "@opennextjs",
    "aws",
    "dist",
    "build",
    "createMiddleware.js"
  );
  const serverBundleFile = path.join(
    process.cwd(),
    "node_modules",
    "@opennextjs",
    "cloudflare",
    "dist",
    "cli",
    "build",
    "open-next",
    "createServerBundle.js"
  );

  if (!fs.existsSync(middlewareFile) || !fs.existsSync(serverBundleFile)) {
    throw new Error(
      "未找到 OpenNext 构建文件，请先执行 npm install 再部署。"
    );
  }

  const changedA = patchCreateMiddleware(middlewareFile);
  const changedB = patchCreateServerBundle(serverBundleFile);

  if (changedA || changedB) {
    console.log("[patch-opennext] 已应用 Windows 构建补丁。");
  } else {
    console.log("[patch-opennext] 补丁已存在，跳过。");
  }
}

run();
