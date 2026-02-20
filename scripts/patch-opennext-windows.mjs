import fs from "node:fs";
import path from "node:path";

const PATCH_MARKER = "OPENNEXT_WINDOWS_TMPDIR_FALLBACK";
const CPSYNC_PATCH_MARKER = "OPENNEXT_WINDOWS_CPSYNC_FIX";

const SAFE_COPY_HELPER = `// ${CPSYNC_PATCH_MARKER}
const __safeCopyRecursive = (src, dest) => {
    const __walk = (s, d) => {
        fs.mkdirSync(d, { recursive: true });
        for (const e of fs.readdirSync(s, { withFileTypes: true })) {
            const sp = path.join(s, e.name);
            const dp = path.join(d, e.name);
            if (e.isDirectory()) __walk(sp, dp);
            else fs.copyFileSync(sp, dp);
        }
    };
    __walk(src, dest);
};
`;

function patchCreateMiddleware(filePath) {
  const original = fs.readFileSync(filePath, "utf8");
  if (original.includes(PATCH_MARKER)) return false;

  const target =
    '        buildHelper.copyOpenNextConfig(options.buildDir, outputPath, await buildHelper.isEdgeRuntime(config.middleware.override));';
  const replacement = `        // ${PATCH_MARKER}: Windows + 非 ASCII 路径下，.open-next/.build 可能缺失 config 文件
        const useEdgeConfig = await buildHelper.isEdgeRuntime(config.middleware.override);
        const configFileName = useEdgeConfig ? "open-next.config.edge.mjs" : "open-next.config.mjs";
        const configFromBuildDir = path.join(options.buildDir, configFileName);
        const configSourceDir = fs.existsSync(configFromBuildDir) ? options.buildDir : options.tempBuildDir;
        buildHelper.copyOpenNextConfig(configSourceDir, outputPath, useEdgeConfig);`;

  if (!original.includes(target)) {
    throw new Error(`未找到可替换片段: ${filePath}\nOpenNext 版本可能已变化，请更新补丁脚本。`);
  }

  fs.writeFileSync(filePath, original.replace(target, replacement), "utf8");
  return true;
}

function patchCreateServerBundle(filePath) {
  const original = fs.readFileSync(filePath, "utf8");
  if (original.includes(PATCH_MARKER)) return false;

  const target =
    "    buildHelper.copyOpenNextConfig(options.buildDir, outPackagePath, true);";
  const replacement = `    // ${PATCH_MARKER}: Windows + 非 ASCII 路径下，.open-next/.build 可能缺失 edge config
    const edgeConfigPath = path.join(options.buildDir, "open-next.config.edge.mjs");
    const configSourceDir = fs.existsSync(edgeConfigPath) ? options.buildDir : options.tempBuildDir;
    buildHelper.copyOpenNextConfig(configSourceDir, outPackagePath, true);`;

  if (!original.includes(target)) {
    throw new Error(`未找到可替换片段: ${filePath}\nOpenNext 版本可能已变化，请更新补丁脚本。`);
  }

  fs.writeFileSync(filePath, original.replace(target, replacement), "utf8");
  return true;
}

/**
 * 找到 fs.cpSync(...) 调用的完整范围（支持嵌套括号）
 * 返回 { start, end, src, dest } 或 null
 */
function findCpSyncCalls(code) {
  const results = [];
  let idx = 0;
  while (true) {
    const pos = code.indexOf("fs.cpSync(", idx);
    if (pos === -1) break;

    // 找到匹配的右括号
    const argsStart = pos + "fs.cpSync(".length;
    let depth = 1;
    let i = argsStart;
    while (i < code.length && depth > 0) {
      if (code[i] === "(") depth++;
      else if (code[i] === ")") depth--;
      i++;
    }
    const argsEnd = i - 1; // 右括号位置
    const fullCall = code.slice(pos, i);

    // 解析前两个参数（跳过嵌套括号中的逗号）
    const argsStr = code.slice(argsStart, argsEnd);
    const args = [];
    let argStart = 0;
    let d = 0;
    for (let j = 0; j < argsStr.length; j++) {
      if (argsStr[j] === "(") d++;
      else if (argsStr[j] === ")") d--;
      else if (argsStr[j] === "," && d === 0) {
        args.push(argsStr.slice(argStart, j).trim());
        argStart = j + 1;
      }
    }
    args.push(argsStr.slice(argStart).trim());

    results.push({
      start: pos,
      end: i,
      fullCall,
      src: args[0],
      dest: args[1],
      allArgs: args,
    });
    idx = i;
  }
  return results;
}

/**
 * 替换文件中所有 fs.cpSync 调用为 __safeCopyRecursive
 */
function patchCpSyncInFile(filePath) {
  const original = fs.readFileSync(filePath, "utf8");
  if (original.includes(CPSYNC_PATCH_MARKER)) return false;

  const calls = findCpSyncCalls(original);
  if (calls.length === 0) return false;

  // 从后向前替换以保持偏移量
  let patched = original;
  for (let i = calls.length - 1; i >= 0; i--) {
    const call = calls[i];
    const replacement = `__safeCopyRecursive(${call.src}, ${call.dest})`;
    patched = patched.slice(0, call.start) + replacement + patched.slice(call.end);
  }

  // 注入 helper 函数（在最后一个 import 语句之后）
  const lastImportIdx = patched.lastIndexOf("import ");
  if (lastImportIdx >= 0) {
    const afterImport = patched.indexOf("\n", lastImportIdx);
    patched =
      patched.slice(0, afterImport + 1) +
      SAFE_COPY_HELPER +
      patched.slice(afterImport + 1);
  } else {
    // 无 import 语句，注入到文件开头
    patched = SAFE_COPY_HELPER + patched;
  }

  fs.writeFileSync(filePath, patched, "utf8");
  return true;
}

/**
 * 递归扫描目录下所有 .js 文件
 */
function walkJs(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkJs(full));
    } else if (entry.name.endsWith(".js")) {
      results.push(full);
    }
  }
  return results;
}

const WRANGLER_WASM_MARKER = "WRANGLER_WINDOWS_WASM_FIX";

/**
 * 补丁 wrangler: writeAdditionalModules 中 ?module 后缀在 Windows 下非法
 * Windows 文件名不能包含 ? 字符，但 wrangler 会把 WASM 模块名 (如 resvg.wasm?module)
 * 直接作为文件名写入临时目录。补丁在写入磁盘时将 ? 替换为 _，
 * 模块的 name 属性保持不变（用于上传到 Cloudflare）。
 */
function patchWranglerWasmWrite(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const original = fs.readFileSync(filePath, "utf8");
  if (original.includes(WRANGLER_WASM_MARKER)) return false;

  const target = `async function writeAdditionalModules(modules, destination) {
  for (const module4 of modules) {
    const modulePath = path32__namespace.default.resolve(destination, module4.name);`;

  const replacement = `async function writeAdditionalModules(modules, destination) {
  // ${WRANGLER_WASM_MARKER}: Windows 文件名不允许 ? 字符
  for (const module4 of modules) {
    const safeName = process.platform === 'win32' ? module4.name.replace(/\\?/g, '_') : module4.name;
    const modulePath = path32__namespace.default.resolve(destination, safeName);`;

  if (!original.includes(target)) {
    // 可能已经是补丁后的版本
    console.log("[patch-opennext] wrangler writeAdditionalModules 目标代码未找到，可能已补丁或版本变化");
    return false;
  }

  let patched = original.replace(target, replacement);

  // 同时替换 sourceMap 的文件名
  const smTarget = `      const sourcemapPath = path32__namespace.default.resolve(destination, module4.sourceMap.name);`;
  const smReplacement = `      const smName = process.platform === 'win32' ? module4.sourceMap.name.replace(/\\?/g, '_') : module4.sourceMap.name;
      const sourcemapPath = path32__namespace.default.resolve(destination, smName);`;

  if (patched.includes(smTarget)) {
    patched = patched.replace(smTarget, smReplacement);
  }

  fs.writeFileSync(filePath, patched, "utf8");
  return true;
}

function run() {
  const middlewareFile = path.join(process.cwd(), "node_modules/@opennextjs/aws/dist/build/createMiddleware.js");
  const serverBundleFile = path.join(process.cwd(), "node_modules/@opennextjs/cloudflare/dist/cli/build/open-next/createServerBundle.js");

  if (!fs.existsSync(middlewareFile) || !fs.existsSync(serverBundleFile)) {
    throw new Error("未找到 OpenNext 构建文件，请先执行 npm install 再部署。");
  }

  const changes = [];

  // 补丁 1 & 2: config 文件路径 fallback
  if (patchCreateMiddleware(middlewareFile)) changes.push("createMiddleware");
  if (patchCreateServerBundle(serverBundleFile)) changes.push("createServerBundle");

  // 补丁 3: fs.cpSync → __safeCopyRecursive（扫描所有相关 .js 文件）
  const awsDir = path.join(process.cwd(), "node_modules/@opennextjs/aws/dist/build");
  const cfDir = path.join(process.cwd(), "node_modules/@opennextjs/cloudflare/dist/cli/build");
  const cfCmdDir = path.join(process.cwd(), "node_modules/@opennextjs/cloudflare/dist/cli/commands");

  for (const dir of [awsDir, cfDir, cfCmdDir]) {
    for (const file of walkJs(dir)) {
      const content = fs.readFileSync(file, "utf8");
      if (content.includes("fs.cpSync") && !content.includes(CPSYNC_PATCH_MARKER)) {
        if (patchCpSyncInFile(file)) {
          changes.push(`${path.relative(process.cwd(), file)}(cpSync)`);
        }
      }
    }
  }

  // 补丁 4: wrangler WASM ?module 文件名在 Windows 下非法
  const wranglerCliJs = path.join(process.cwd(), "node_modules/wrangler/wrangler-dist/cli.js");
  if (patchWranglerWasmWrite(wranglerCliJs)) changes.push("wrangler(wasm?module)");

  if (changes.length > 0) {
    console.log(`[patch-opennext] 已应用 Windows 构建补丁: ${changes.join(", ")}`);
  } else {
    console.log("[patch-opennext] 补丁已存在，跳过。");
  }
}

run();
