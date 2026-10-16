/**
 * dsh-ui-tweaks host half.
 *
 * 两条回环路由：
 * - GET  /api/ui-tweaks/local-plugins：返回当前 profile package.json
 *   dependencies 里非 registry 直装（link:/file:/git+/github:/http）的包名清单，
 *   外加运行中的 DSH 版本（`dsh` 字段，读不到为空串）—— 客户端更新面板据此把
 *   「新版要求更高 DSH」的行标成「DSH 不符」，不让人装上去起不来。
 *   浏览器半区的更新面板据此把这些插件标成「本地链接」或「Git 直装」、跳过
 *   registry 比对 —— listBundles 不透传安装来源，而「npm 上恰好也发布过」的
 *   非 registry 源（如 @nimoxie/dsh-model-organizer）在客户端侧没有别的办法认。
 * - POST /api/ui-tweaks/normalize-excludes：手动触发一次下面的归并，回
 *   {ok, changed, kept, removed}；插件加载时也会静默跑一次。
 * - GET  /api/ui-tweaks/restart：只读「重启方案」（shell / relaunch / manual），
 *   POST 同路径才真的执行（先写响应、约 0.4s 后退出进程）；非回环 403、其它方法 405。
 *   故意拆成两个方法：GET 无副作用，浏览器预取或直接粘 URL 都不会把宿主停掉。
 *   三种模式见文件末尾「模块 7」。
 *
 * 写操作（全文件只此一处）：归并 profile 的 pnpm-workspace.yaml 里
 * minimumReleaseAgeExclude 序列。为什么必须收敛：
 * DSH 给自带 pnpm 11.7.0 注入供应链策略 minimumReleaseAge=1440（分钟，不在任何配置文件里），
 * pnpm 在解析之前先校验磁盘上现有的 lockfile，任一 entry 未成熟即整体中止安装并报
 * ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION（exit 1）；而该白名单按包名匹配，同一个包名出现
 * 多条时「文件中靠前的那条生效」。于是同包重复/陈旧条目会静默抵消掉真正需要的豁免
 * （例：dsh-context@0.61.0 陈旧条排在 dsh-context@0.69.0 前面，后者从未生效），
 * 之后 profile 的每一次安装都失败；而一次成功的「未成熟版本」安装又会把新条目追加到
 * 末尾，让旧条重新变成靠前那条 —— 紧接着的下一次安装立刻 FAIL。所以这必须常态化自动收敛。
 * 安全约束：只改这一个序列，其余字节逐字节保持原样；写前备份
 * pnpm-workspace.yaml.bak-<时间戳>；同目录临时文件 + renameSync 原子替换；写后重读校验；
 * 无变化不写文件；幂等；结果永远是原条目的子集（绝不比现状更宽松）；陈旧剪除只针对
 * profile dependencies 里的受管包名，重复折叠适用于任何包名；裸名（不带 @版本）豁免该包
 * 全部版本，永不视为陈旧。整个过程不外抛异常。仅回环访问放行。
 *
 * 模块 6：官方桌面客户端的窗口记忆（记住主窗口上次的大小/位置/最大化状态）。
 * 官方主进程写死 1280x820 且无任何窗口状态持久化；渲染层被官方沙箱焊死
 * （contextIsolation+sandbox，dshDesktop 桥只暴露给 dsh-app://app 主框架），
 * 页面里拿不到任何窗口能力，所以这条路走插件服务端 + 进程外 Win32：
 * spawn 一个隐藏 PowerShell helper（lib/window-helper.ps1），沿父进程链找到
 * DeepSeek Harness.exe 的主窗口。实测客户端在插件加载前就已把窗口 show 出来，
 * 隐藏期无感还原做不到，可达的是窗口出现后 ~0.2s 内归位（肉眼基本无感，且
 * 先于任何插件 UI 打开）；之后每秒采样 GetWindowPlacement 持久化。
 * 仅 Windows + ELECTRON_RUN_AS_NODE=1（官方客户端内的 dsh 运行时）时激活；
 * web profile / dsh-web-shell 下自动不动作。文件落 profile 的 ui-tweaks/ 子目录。
 *
 * 模块 7：立即重启（让刚装上的插件代码在下一次启动被加载）。
 * 参考 @linxin666/dsh-client-ui-plugin-manager 的三段式：只读方案 → 二次确认 → 执行。
 * 复用它的三条经验（都是真机踩出来的）：① 方案按运行形态分三种 —— 打包桌面端由
 * Electron 外壳管进程树，插件重启不了它，只能自己退出、等外壳弹它自己的重启对话框
 * （shell）；终端里跑的 dsh 用 detached 助手按原命令行重拉（relaunch，剔除 --inspect
 * 之类会重新绑定端口的开关）；被监督/无 TTY 的进程不动，如实报 manual。② relaunch 起
 * 不了助手时退化为 manual —— 绝不在无法重拉的情况下把进程停掉。③ 重启前先 GET 读方案，
 * 让确认面板说的后果与实际执行一致。
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

export const name = "ui-tweaks";
export const inject = ["webServer"];

const SELF = "@nimoxie/dsh-ui-tweaks";
const LOCAL_SPEC_RE = /^(link:|file:)/;                 // 本地路径（link:→按包名查 node_modules）
const REMOTE_SPEC_RE = /^(git[+:@]|github:|git:|http)/; // Git 仓库 / URL 直装
const LOOPBACK_RE = /^(127\.|::1$|::ffff:127\.)/;
const EXCLUDE_KEY = "minimumReleaseAgeExclude";
const WORKSPACE_FILE = "pnpm-workspace.yaml";

function readJson(p) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

function hasUs(m) {
  return !!(m && m.dsh && m.dsh.profile && Array.isArray(m.dsh.profile.bundles) && m.dsh.profile.bundles.includes(SELF));
}

function findProfileDir() {
  // ① npm 直装：包物理位于 profile/node_modules 内，向上走必经 profile 根
  //   （profile 根 package.json 的判据是 dsh.profile.bundles 且包含本插件）。
  let dir = dirname(dirname(fileURLToPath(import.meta.url)));
  for (let depth = 0; depth < 8; depth++) {
    const m = readJson(join(dir, "package.json"));
    if (hasUs(m)) { return dir; }
    const parent = dirname(dir);
    if (parent === dir) { break; }
    dir = parent;
  }
  // ② link: 软链安装：Node 默认把 ESM 模块解析到真实路径，import.meta.url
  //    指向 profile 外的仓库目录，①必然失败。退回扫描 profiles/*：
  //    DSH_HOME 环境变量 → 用户主目录默认 .dsh（dsh 未设环境变量时的标准位置）。
  //    多个 profile 都装了本插件时按 host 进程形态二选一
  //    （桌面 host 跑在 ELECTRON_RUN_AS_NODE=1 的 Electron Node 下）。
  const homes = [process.env.DSH_HOME, join(homedir(), ".dsh")].filter(Boolean);
  let hits = [];
  for (const home of homes) {
    try {
      for (const entry of readdirSync(join(home, "profiles"))) {
        const dir2 = join(home, "profiles", entry);
        if (hasUs(readJson(join(dir2, "package.json")))) { hits.push(dir2); }
      }
    } catch { /* 该 home 不存在或不可读，试下一个 */ }
    if (hits.length) { break; }
  }
  if (hits.length === 0) { return null; }
  if (hits.length === 1) { return hits[0]; }
  const wanted = process.env.ELECTRON_RUN_AS_NODE === "1" ? "desktop" : "web";
  return hits.find((d) => new RegExp(wanted + "$").test(d)) || hits[0];
}

// ---------- minimumReleaseAgeExclude 归并 ----------

/** yaml 标量去引号：'x' / "x" → x，其余原样 */
function unquote(s) {
  const m = /^(['"])([\s\S]*)\1$/.exec(s);
  return m ? m[2] : s;
}

/** 条目原文 → 裸值：去空白、去行尾注释、去引号 */
function entryValue(raw) {
  const s = String(raw).trim();
  const quoted = unquote(s);
  if (quoted !== s) { return quoted; }      // 整段就是带引号的标量
  const i = s.indexOf(" #");                // 裸标量后跟注释
  return i < 0 ? s : unquote(s.slice(0, i).trim());
}

/** 版本键里的 'name@version' → {name, version}（scoped 与裸名都要能分） */
function splitNameVersion(s) {
  const at = s.startsWith("@") ? s.indexOf("@", 1) : s.indexOf("@");
  if (at <= 0) { return { name: s, version: null }; }
  return { name: s.slice(0, at), version: s.slice(at + 1) || null };
}

/** '1.2.3(peer@x)' → '1.2.3'；link:/file:/workspace: 协议没有版本概念 → undefined */
function cleanVersion(v) {
  const s = String(v || "").trim().replace(/\([\s\S]*$/, "").replace(/^['"]|['"]$/g, "");
  if (!s || /^(link:|file:|workspace:)/.test(s)) { return undefined; }
  return s;
}

/**
 * 从 pnpm-lock.yaml 取两张表：
 *   importers = profile 自己声明的直连依赖（面板管的那些插件）
 *   all       = importers 覆盖后的全量（含传递依赖）
 * link:/file:/workspace: 这类没有发布版本的条目不进表（查询得到 undefined = 未锁定）。
 */
function parseLockMaps(text) {
  const fromImporters = new Map();
  const fromPackages = new Map();
  let section = null;
  let inImporterDeps = false;
  let pendingName = null;
  for (const line of String(text).split(/\r?\n/)) {
    const top = /^([A-Za-z][\w-]*):\s*$/.exec(line);   // 缩进 0 的顶层段落
    if (top) { section = top[1]; inImporterDeps = false; pendingName = null; continue; }
    if (section === "importers") {
      if (/^ {4}(?:dependencies|devDependencies|optionalDependencies):\s*$/.test(line)) { inImporterDeps = true; continue; }
      if (/^ {2,4}\S/.test(line)) { inImporterDeps = false; continue; }   // 换 importer / 换字段
      if (inImporterDeps) {
        const k = /^ {6}(\S[\s\S]*?):\s*$/.exec(line);
        if (k) { pendingName = unquote(k[1]); continue; }
        const v = /^ {8}version:\s*(\S+)\s*$/.exec(line);
        if (v && pendingName) {
          const ver = cleanVersion(v[1]);
          if (ver) { fromImporters.set(pendingName, ver); }
          pendingName = null;
          continue;
        }
      }
    } else if (section === "packages") {
      const k = /^ {2}(\S[\s\S]*?):\s*$/.exec(line);      // 'name@version':
      if (k) {
        const p = splitNameVersion(unquote(k[1]));
        const ver = p.version && cleanVersion(p.version);
        if (ver) { fromPackages.set(p.name, ver); }
      }
    }
  }
  const out = new Map(fromPackages);
  for (const [k, v] of fromImporters) { out.set(k, v); }
  return { all: out, importers: fromImporters };
}

/** 兼容入口：全量映射（归并器用） */
function parseLockVersions(text) {
  return parseLockMaps(text).all;
}

/**
 * 归并 profile pnpm-workspace.yaml 的 minimumReleaseAgeExclude 序列。
 * 只重排这一段的条目行，其余字节逐字节保留；无变化不写盘。
 * 任何异常都被吞掉，返回 {ok:false, code}。
 * dirOverride 只给测试用（指向临时目录），生产走 findProfileDir()。
 */
export function normalizeReleaseAgeExcludes(dirOverride) {
  let backup = null;
  try {
    const dir = dirOverride || findProfileDir();
    if (!dir) { return { ok: false, code: "profile-not-found" }; }
    const wsPath = join(dir, WORKSPACE_FILE);
    let raw;
    try { raw = readFileSync(wsPath, "utf8"); }
    catch (e) { return { ok: false, code: "workspace-unreadable: " + String((e && e.code) || e) }; }

    // 受管包名：profile dependencies 的键
    const manifest = readJson(join(dir, "package.json"));
    const managed = new Set(Object.keys((manifest && manifest.dependencies) || {}));

    // 锁定版本：lockfile 不可读/不存在时留空表，陈旧剪除据此退化为「无版本可依」
    let locked = new Map();
    let lockKnown = false;
    try { locked = parseLockVersions(readFileSync(join(dir, "pnpm-lock.yaml"), "utf8")); lockKnown = true; } catch { /* 无 lockfile */ }

    // 段落解析与强制豁免共用 excludeBlockOf：两个写者（自动归并 / 手动强制）必须对
    // 「这个块从哪到哪」有一致判断，否则会出现遮蔽条（旧笔记里踩过的坑）。
    const blk = excludeBlockOf(raw);
    const lines = blk.lines;
    const keyLine = blk.keyLine;
    // 没有这个键不是错误：profile 本来就没有待归并的条目（或已被清理干净），按「无变化」回。
    if (keyLine < 0) { return { ok: true, changed: false, kept: [], removed: [], path: wsPath }; }
    const entries = blk.entries;
    // 键在但一条条目都没有，同样按「无变化」回（客户端是 fire-and-forget，500 只会变成日志噪声）。
    if (entries.length === 0) { return { ok: true, changed: false, kept: [], removed: [], path: wsPath }; }

    const groups = new Map();   // name → [entry…]（保序）
    for (const e of entries) {
      if (!groups.has(e.name)) { groups.set(e.name, []); }
      groups.get(e.name).push(e);
    }

    const keep = new Set();   // 保留的条目行号
    const removed = [];
    for (const [pkg, group] of groups) {
      if (group.length >= 2) {
        // 重复折叠：优先保留「版本 == lockfile 锁定版本」的那条，否则保留文件中第一条
        // （与 pnpm「靠前者生效」的现行语义一致，且结果永远是原并集的子集）。
        const want = locked.get(pkg);
        const chosen = (want && group.find((e) => e.version === want)) || group[0];
        keep.add(chosen.idx);
        for (const e of group) { if (e !== chosen) { removed.push(e.value); } }
        continue;
      }
      const e = group[0];
      // 陈旧剪除：只碰受管包名；裸名豁免全部版本，永不视为陈旧。
      // lockfile 整个缺失时不剪除（此时「锁定版本」无从谈起，剪掉受管条可能把
      // 尚未安装的 profile 卡死 —— 宁可不动，提交集方向也依然安全）。
      if (lockKnown && managed.has(pkg) && e.version !== null && e.version !== locked.get(pkg)) {
        removed.push(e.value);
        continue;
      }
      keep.add(e.idx);
    }

    const entryIdx = new Set(entries.map((e) => e.idx));
    const keptInOrder = entries.filter((e) => keep.has(e.idx)).map((e) => e.value);
    const newRaw = lines.filter((line, i) => !entryIdx.has(i) || keep.has(i)).join("");

    if (newRaw === raw) { return { ok: true, changed: false, kept: keptInOrder, removed: [], path: wsPath }; }

    // 备份 + 原子替换 + 写后重读校验（与强制豁免共用同一套，含 .bak 只留最近几份）
    const w = atomicWriteWorkspace(dir, wsPath, raw, newRaw);
    backup = w.backup;
    if (!w.ok) { return { ok: false, code: w.code, path: wsPath, backup }; }

    return { ok: true, changed: true, kept: keptInOrder, removed, path: wsPath, backup };
  } catch (e) {
    return { ok: false, code: String((e && e.message) || e) };
  }
}

/**
 * 模块 6：官方桌面客户端的窗口记忆（见文件头注释）。
 * 只在 Windows + 官方客户端内的 dsh 运行时里动作；其它环境静默返回。
 */
function startWindowState(ctx) {
  if (process.platform !== "win32") { return; }
  if (process.env.ELECTRON_RUN_AS_NODE !== "1") { return; } // 仅官方客户端内的 dsh 运行时
  try {
    const dir = join(findProfileDir() || join(tmpdir(), "dsh-ui-tweaks"), "ui-tweaks");
    mkdirSync(dir, { recursive: true });
    // helper 落在 profile 子目录：.cs/.dll/.ps1 路径按 profile 唯一，仓库被删/移动后
    // 已启动的 helper 不受影响，编译缓存也跟 profile 走。
    const srcName = "window-helper.cs";
    const csPath = join(dir, srcName);
    const dllPath = join(dir, "window-helper.dll");
    // 内容没变就不重写 .cs：mtime 稳定才能让下面的 staleness 判断跳过重编译，
    // 否则每次客户端启动都白白同步编译 1~3s（阻塞 runtime 启动）。
    const srcContent = "\ufeff" + readFileSync(join(dirname(fileURLToPath(import.meta.url)), srcName), "utf8");
    let curContent = null;
    try { curContent = readFileSync(csPath, "utf8"); } catch { }
    if (curContent !== srcContent) { writeFileSync(csPath, srcContent); }
    const statePath = join(dir, "window-state.json");
    const logPath = join(dir, "window-helper.log");

    // Win32 interop 预编译成 DLL（系统 csc，仅首次/插件更新后一次，1~3s）。
    // 关键：绝不走独立 exe —— 本地编译的无签名 exe 会被 Windows/安全软件以
    // 「无法验证发布者」反复拦截（实测）；DLL 由 PowerShell 进程内加载，
    // 不触发任何安全提示，且免去 exe 的启动开销。
    let stale = true;
    try { stale = statSync(dllPath).mtimeMs < statSync(csPath).mtimeMs; } catch { }
    if (stale) {
      const csc = ["/Microsoft.NET/Framework64/v4.0.30319/csc.exe", "/Microsoft.NET/Framework/v4.0.30319/csc.exe"]
        .map((p) => join(process.env.SystemRoot || "C:\\Windows", p))
        .find((p) => { try { return statSync(p).isFile(); } catch { return false; } });
      if (!csc) {
        try { console.warn("[ui-tweaks] 未找到 csc.exe（.NET Framework），窗口记忆不可用"); } catch { }
        return;
      }
      const r = spawnSync(csc, ["-nologo", "-target:library", "-optimize+", `-out:${dllPath}`, csPath], { timeout: 30000 });
      if (!existsSync(dllPath)) {
        try { console.warn("[ui-tweaks] window-helper.dll 编译失败：" + String(r.stderr || r.stdout || "").slice(-300)); } catch { }
        return;
      }
    }

    const helperPath = join(dir, "window-helper.ps1");
    // 必须 UTF-8 BOM：PS 5.1 对无 BOM 脚本按 ANSI 解析，非 ASCII 内容会吞掉
    // 换行、静默吞掉下一行代码（实测踩过三次）。
    writeFileSync(helperPath, "\ufeff" + readFileSync(join(dirname(fileURLToPath(import.meta.url)), "window-helper.ps1"), "utf8"));
    const ps = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const child = spawn(ps, [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
      "-File", helperPath,
      "-DshPid", String(process.pid),
      "-StateFile", statePath,
      "-LogPath", logPath,
    ], { stdio: "ignore", windowsHide: true });
    child.on("error", (e) => {
      try { console.warn("[ui-tweaks] window-state helper 启动失败：" + ((e && e.message) || e)); } catch { }
    });
    ctx.effect(() => () => { try { child.kill(); } catch { } }, "ui-tweaks: window-state helper");
  } catch (e) {
    try { console.warn("[ui-tweaks] window-state 初始化失败：" + ((e && e.message) || e)); } catch { }
  }
}

/**
 * 解析 minimumReleaseAgeExclude 段落 → { keyLine, lines, entries }。
 * 与归并器共用同一套「序列条目必须缩进」的语义；未找到键时 keyLine = -1。
 */
function excludeBlockOf(raw) {
  const lines = String(raw).split(/(?<=\n)/);   // 每行带着自己的换行符，join 即还原
  const keyRe = new RegExp("^" + EXCLUDE_KEY + "\\s*:\\s*(?:#[\\s\\S]*)?$");
  let keyLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (keyRe.test(lines[i].replace(/\r?\n$/, ""))) { keyLine = i; break; }
  }
  const entries = [];
  if (keyLine >= 0) {
    for (let i = keyLine + 1; i < lines.length; i++) {
      const body = lines[i].replace(/\r?\n$/, "");
      const m = /^(\s*)-\s+(\S[\s\S]*)$/.exec(body);
      if (!m || m[1].length === 0) { break; }
      const value = entryValue(m[2]);
      const nv = splitNameVersion(value);
      entries.push({ idx: i, line: lines[i], value, name: nv.name, version: nv.version });
    }
  }
  return { keyLine, lines, entries };
}

/** 每包的「生效豁免」：同包多条只有靠前那条生效（实测）；裸名 = 豁免该包全部版本 → null */
function effectiveExemptions(raw) {
  const out = new Map();
  for (const e of excludeBlockOf(raw).entries) {
    if (out.has(e.name)) { continue; }
    out.set(e.name, e.version === null ? null : e.version);
  }
  return out;
}

/** 备份 + 同目录临时文件 + renameSync 原子替换 + 写后重读校验（归并器与强制豁免共用）。
 *  .bak 只保留最近 KEEP_BAK 份：归并器每次插件加载都会跑，长期下来旧备份会无限堆积。 */
const KEEP_BAK = 3;
function atomicWriteWorkspace(dir, wsPath, raw, newRaw) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = wsPath + ".bak-" + stamp;
  writeFileSync(backup, raw, "utf8");
  try {
    const hits = readdirSync(dir).filter((n) => n.startsWith(WORKSPACE_FILE + ".bak-")).sort();
    for (const old of hits.slice(0, Math.max(0, hits.length - KEEP_BAK))) {
      try { unlinkSync(join(dir, old)); } catch { /* 删不掉就留着，不影响主流程 */ }
    }
  } catch { /* 目录读不了就算了 */ }
  const tmp = join(dir, "." + WORKSPACE_FILE + ".tmp-" + process.pid + "-" + Date.now());
  try {
    writeFileSync(tmp, newRaw, "utf8");
    renameSync(tmp, wsPath);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* 临时文件可能未创建 */ }
    throw e;
  }
  const after = readFileSync(wsPath, "utf8");
  if (after !== newRaw) { return { ok: false, code: "verify-mismatch", path: wsPath, backup }; }
  return { ok: true, path: wsPath, backup };
}

/**
 * 强制豁免：让 `name@version` 成为豁免表的**第一条**（pnpm 按「同包名靠前者生效」匹配，
 * 实测 [陈旧条, 未成熟条] 失败、[未成熟条, 陈旧条] 通过）。其余条目逐字节不动，
 * 只在块首插入/移动一行；同包旧条目留在后面，之后由归并器收敛成一条。
 */
export function forceExemptVersion(name, version, dirOverride) {
  try {
    const dir = dirOverride || findProfileDir();
    if (!dir) { return { ok: false, code: "profile-not-found" }; }
    const wsPath = join(dir, WORKSPACE_FILE);
    let raw;
    try { raw = readFileSync(wsPath, "utf8"); }
    catch (e) { return { ok: false, code: "workspace-unreadable: " + String((e && e.code) || e) }; }

    const value = String(name) + "@" + String(version);
    const blk = excludeBlockOf(raw);
    let newRaw;
    if (blk.keyLine < 0) {
      // 没有这个键：文件末尾追加一段（原字节全部保留）
      const sep = raw.length === 0 || raw.endsWith("\n") ? "" : "\n";
      newRaw = raw + sep + EXCLUDE_KEY + ":\n  - " + value + "\n";
    } else {
      const first = blk.entries[0];
      const indent = first ? (/^(\s*)-/.exec(first.line) || [])[1] || "  " : "  ";
      const insert = indent + "- " + value + "\n";
      const dup = blk.entries.find((e) => e.value === value);
      const lines = blk.lines.slice();
      if (dup) { lines.splice(dup.idx, 1); }        // 已有同值条目：移到块首
      const at = blk.keyLine + 1;
      newRaw = lines.slice(0, at).join("") + insert + lines.slice(at).join("");
    }

    if (newRaw === raw) { return { ok: true, changed: false, path: wsPath, entry: value }; }
    const w = atomicWriteWorkspace(dir, wsPath, raw, newRaw);
    if (!w.ok) { return { ok: false, code: w.code, path: wsPath, backup: w.backup }; }
    return { ok: true, changed: true, path: wsPath, backup: w.backup, entry: value };
  } catch (e) {
    return { ok: false, code: String((e && e.message) || e) };
  }
}

// 发布时长缓存：预检要查多个包，10 分钟内复用（发布时刻不会变，缓存只为省流量）
const PUB_TIME_CACHE = new Map();
const PUB_TIME_TTL_MS = 10 * 60 * 1000;

async function publishedAtOf(name, version) {
  const key = String(name) + "@" + String(version);
  const hit = PUB_TIME_CACHE.get(key);
  if (hit && Date.now() - hit.at < PUB_TIME_TTL_MS) { return hit.publishedAt; }
  let val = null;
  try {
    const path = String(name).split("/").map(encodeURIComponent).join("/");
    const res = await fetch("https://registry.npmjs.org/" + path, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const txt = await res.text();
      if (txt.length <= 8 * 1024 * 1024) {
        const doc = JSON.parse(txt);
        const t = doc && doc.time && doc.time[version];
        const ms = t ? Date.parse(t) : NaN;
        if (isFinite(ms)) { val = ms; }
      }
    }
  } catch { /* 查不到就返回 null，调用方按「未知」处理，不拦 */ }
  PUB_TIME_CACHE.set(key, { at: Date.now(), publishedAt: val });
  // TTL 只决定「要不要复用」，不回收条目；预检目前只扫直连依赖（几条），但若以后
  // 扩到全量 lockfile 就会长期增长 —— 超过上限时清掉已过期项。
  if (PUB_TIME_CACHE.size > 500) {
    const now = Date.now();
    for (const [k, v] of PUB_TIME_CACHE) {
      if (now - v.at >= PUB_TIME_TTL_MS) { PUB_TIME_CACHE.delete(k); }
    }
  }
  return val;
}

/**
 * 预检：这次强制更新会不会被别的包拦住。
 * 只看 profile 的**直连依赖**（pnpm-lock 的 importers 段＝面板管的那些插件；传递依赖不扫，
 * 那要几百次网络查询），逐个判断「锁定版本是否已生效豁免」；没豁免的查发布时间，
 * 仍在窗口内的列为拦路者。目标包自己跳过（强制流程会先给它写豁免）。
 * 注意：门禁校验的是整个 lockfile，传递依赖或漏判的情况由安装失败时的反应式报错兜底
 * （pnpm 的报错会点名违规条目）。
 */
export async function precheckExempt(name, version, opts) {
  const o = opts || {};
  try {
    const dir = o.dir || findProfileDir();
    if (!dir) { return { ok: false, code: "profile-not-found" }; }
    const windowMs = isFinite(o.windowMs) && o.windowMs > 0 ? o.windowMs : 1440 * 60000;
    let importerVersions;
    try { importerVersions = parseLockMaps(readFileSync(join(dir, "pnpm-lock.yaml"), "utf8")).importers; }
    catch (e) { return { ok: false, code: "lockfile-unreadable: " + String((e && e.code) || e) }; }
    let eff = new Map();
    try { eff = effectiveExemptions(readFileSync(join(dir, WORKSPACE_FILE), "utf8")); } catch { /* 无 workspace 文件＝无豁免 */ }

    const now = Date.now();
    const blocked = [];
    let checked = 0;
    for (const [pkg, ver] of importerVersions) {
      if (pkg === name) { continue; }
      if (!ver) { continue; }
      if (eff.has(pkg)) {
        const e = eff.get(pkg);
        if (e === null || e === ver) { continue; }   // 裸名豁免全部版本 / 精确命中锁定版本
      }
      const pub = await publishedAtOf(pkg, ver);
      checked++;
      if (pub !== null && pub + windowMs > now) {
        blocked.push({ name: pkg, version: ver, publishedAt: pub, matureAt: pub + windowMs });
      }
    }
    blocked.sort((a, b) => a.matureAt - b.matureAt);
    return { ok: true, blocked, checked, windowMs };
  } catch (e) {
    return { ok: false, code: String((e && e.message) || e) };
  }
}

// ---------- 运行中的 DSH 版本（更新前的兼容门禁用） ----------

/** 缓存：同一进程里版本不会变；读不到也缓存 null，避免每次检查都重试 */
let dshVersionCache;

/**
 * 运行中的 DSH 版本。首选宿主在 `profileContext` 上发布的 installAnchor（一个指向
 * 运行中 @deepseek-ai/dsh 清单的绝对路径）—— 打包桌面端唯一答得上的来源；兜底读
 * profile 自己装的 @deepseek-ai/dsh（npm 运行时）。
 * 读不到返回 null：调用方据此**不做**兼容门禁（宁可漏拦，不误伤正常更新）。
 */
function dshVersionOf(ctx) {
  if (dshVersionCache !== undefined) { return dshVersionCache; }
  dshVersionCache = null;
  try {
    const launched = ctx && typeof ctx.get === "function" ? ctx.get("profileContext") : null;
    const anchor = launched && typeof launched.installAnchor === "string" ? launched.installAnchor.trim() : "";
    if (anchor) {
      const m = readJson(anchor);
      if (m && typeof m.version === "string" && m.version.trim()) { dshVersionCache = m.version.trim(); return dshVersionCache; }
    }
  } catch { /* 没发布 anchor 的运行时 */ }
  try {
    const dir = findProfileDir();
    const m = dir ? readJson(join(dir, "node_modules", "@deepseek-ai", "dsh", "package.json")) : null;
    if (m && typeof m.version === "string" && m.version.trim()) { dshVersionCache = m.version.trim(); }
  } catch { /* 读不到就算了 */ }
  return dshVersionCache;
}

// ---------- 模块 7：立即重启 ----------

/** 重启助手等待旧进程退出的上限（毫秒）；超时就照拉，避免助手永远等下去 */
const RESTART_WAIT_MS = 30000;

/** --inspect 系列会让新进程重新绑定固定端口，重拉时必须剔除 */
function isReusableExecArg(a) {
  return !/^--(?:inspect|inspect-brk|inspect-port|debug|debug-brk)(?:=|$)/.test(String(a));
}

/** 是否跑在官方桌面客户端里（进程树归 Electron 外壳，插件重启不了它） */
function isDesktopRuntime(env) {
  const e = env || process.env || {};
  return String(e.ELECTRON_RUN_AS_NODE || "") === "1" || !!(process.versions && process.versions.electron);
}

/**
 * 重启方案（纯函数，便于隔离测试）：
 *   shell    —— 桌面客户端：只退出，重启交给外壳自己的对话框
 *   relaunch —— 终端里跑起来的 dsh：detached 助手按原命令行重拉
 *   manual   —— 无 TTY / 被别的程序托管：不动，如实告诉用户手动重启
 */
export function planRestart(facts) {
  const f = facts || {};
  if (f.desktop === true) { return { mode: "shell" }; }
  if (!f.interactive) { return { mode: "manual" }; }
  const script = f.argv && f.argv[0];
  if (!script) { return { mode: "manual" }; }
  return {
    mode: "relaunch",
    command: {
      execPath: f.execPath,
      argv: (f.execArgv || []).filter(isReusableExecArg).concat([script], (f.argv || []).slice(1)),
      cwd: f.cwd,
      env: f.env || process.env,
    },
  };
}

/** 重启日志：与 dsh 自己的日志同处 $DSH_HOME/logs 下 */
function restartLogPath() {
  const home = process.env.DSH_HOME || join(homedir(), ".dsh");
  return join(home, "logs", "ui-tweaks-restart.log");
}

/**
 * 重拉助手：作为 `node -e <源码> <job-json>` 运行，必须自包含、无依赖。
 * 先等旧进程消失（或等满 waitMs），再按原命令行把 dsh 拉起来；新进程若 3 秒内
 * 就退出，最多重试 5 次（端口还没释放这类瞬时失败很常见），日志落盘。
 */
const RELAUNCH_HELPER = [
  "const fs=require('node:fs'),cp=require('node:child_process');",
  "const job=JSON.parse(process.argv[1]);",
  "fs.mkdirSync(job.logDir,{recursive:true});",
  "const fd=fs.openSync(job.logPath,'a');",
  "const log=(l)=>{try{fs.appendFileSync(job.logPath,new Date().toISOString()+' '+l+'\\n')}catch{}};",
  "const alive=(pid)=>{try{process.kill(pid,0);return true}catch{return false}};",
  "const launch=(n)=>{",
  "  if(n>0)log('relaunch attempt '+(n+1));",
  "  const ch=cp.spawn(job.execPath,job.argv,{cwd:job.cwd,env:process.env,detached:true,stdio:['ignore',fd,fd]});",
  "  ch.unref();let code=null;ch.on('exit',(v)=>{code=v});",
  "  setTimeout(()=>{if(code===null){log('relaunch started (pid '+ch.pid+')');fs.closeSync(fd);return}"
    + "if(n<4){log('relaunch exited with '+code+'; retrying');launch(n+1);return}"
    + "log('relaunch gave up after exit '+code);fs.closeSync(fd)},3000)};",
  "const wait=(dl)=>{if(!alive(job.parentPid)||Date.now()>=dl){setTimeout(()=>launch(0),300);return}setTimeout(()=>wait(dl),200)};",
  "wait(Date.now()+job.waitMs);",
].join("\n");

/** 起一个 detached 重拉助手；起不来返回 false（调用方据此退化为 manual） */
export function startRelaunchHelper(command, logPath) {
  const file = logPath || restartLogPath();
  const job = {
    parentPid: process.pid,
    execPath: command.execPath,
    argv: command.argv,
    cwd: command.cwd,
    logDir: dirname(file),
    logPath: file,
    waitMs: RESTART_WAIT_MS,
  };
  try {
    mkdirSync(dirname(file), { recursive: true });
    const helper = spawn(command.execPath, ["-e", RELAUNCH_HELPER, JSON.stringify(job)], {
      cwd: command.cwd,
      env: command.env || process.env,
      detached: true,
      stdio: "ignore",
    });
    helper.unref();
    return helper.pid !== undefined;
  } catch (e) {
    try { appendFileSync(file, new Date().toISOString() + " helper failed: " + String((e && e.message) || e) + "\n"); } catch { /* 日志写不了就算了 */ }
    return false;
  }
}

/**
 * 执行方案：先安排退出（0.4s 后，够响应写回浏览器），再让进程消失。
 * relaunch 起不了助手 → manual：进程留在原地，不把用户丢在没有服务的状态。
 * runtime 只为隔离测试注入（默认就是真的起助手 / 真的退出）。
 */
export function performRestart(plan, runtime) {
  const rt = runtime || {};
  if (plan.mode === "manual") { return "manual"; }
  if (plan.mode === "relaunch") {
    const start = rt.startHelper || ((command) => startRelaunchHelper(command));
    if (!plan.command || !start(plan.command)) { return "manual"; }
  }
  const schedule = rt.schedule || ((run, ms) => { setTimeout(run, ms); });
  const exit = rt.exit || (() => { process.exit(0); });
  schedule(exit, 400);
  return plan.mode;
}

/** 本进程自己的启动事实（只读，每次请求现取） */
function liveRestartFacts() {
  return {
    desktop: isDesktopRuntime(process.env),
    interactive: process.stdin.isTTY === true || process.stdout.isTTY === true,
    execPath: process.execPath,
    argv: process.argv.slice(1),
    execArgv: process.execArgv,
    cwd: process.cwd(),
    env: process.env,
  };
}

export function apply(ctx) {
  const respond = (res) => (code, body) => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(body);
  };
  const isLoopback = (req) => LOOPBACK_RE.test(String((req.socket && req.socket.remoteAddress) || ""));

  // 小体积 JSON body 读取（只给下面两条强制更新路由用；上限 8KB，超了当非法）
  const readJsonBody = (req, cb) => {
    let buf = "";
    let bad = false;
    req.on("data", (c) => { if (bad) { return; } buf += c; if (buf.length > 8192) { bad = true; } });
    req.on("end", () => {
      if (bad) { cb({}); return; }
      try { cb(buf ? JSON.parse(buf) : {}); } catch { cb({}); }
    });
    req.on("error", () => cb({}));
  };

  const routes = [
    {
      kind: "exact",
      path: "/api/ui-tweaks/local-plugins",
      handler: (req, res) => {
        const done = respond(res);
        try {
          if (!isLoopback(req)) { done(403, JSON.stringify({ ok: false, code: "forbidden" })); return; }
          if (req.method !== "GET") { done(405, JSON.stringify({ ok: false, code: "method not allowed" })); return; }
          const dir = findProfileDir();
          const manifest = dir ? readJson(join(dir, "package.json")) : null;
          const deps = (manifest && manifest.dependencies) || {};
          const local = [];   // link:/file: —— 本地路径
          const remote = [];  // git/github/http —— 仓库或 URL 直装
          for (const [n, spec] of Object.entries(deps)) {
            const s = String(spec);
            if (LOCAL_SPEC_RE.test(s)) { local.push(n); }
            else if (REMOTE_SPEC_RE.test(s)) { remote.push(n); }
          }
          done(200, JSON.stringify({ ok: true, local, remote, profile: (manifest && manifest.name) || "", dsh: dshVersionOf(ctx) || "" }));
        } catch (e) {
          done(500, JSON.stringify({ ok: false, code: String((e && e.message) || e) }));
        }
      }
    },
    {
      kind: "exact",
      path: "/api/ui-tweaks/normalize-excludes",
      handler: (req, res) => {
        const done = respond(res);
        try {
          if (!isLoopback(req)) { done(403, JSON.stringify({ ok: false, code: "forbidden" })); return; }
          if (req.method !== "POST") { done(405, JSON.stringify({ ok: false, code: "method not allowed" })); return; }
          const r = normalizeReleaseAgeExcludes();
          if (!r.ok) { done(500, JSON.stringify({ ok: false, code: r.code })); return; }
          done(200, JSON.stringify({ ok: true, changed: r.changed, kept: r.kept, removed: r.removed }));
        } catch (e) {
          done(500, JSON.stringify({ ok: false, code: String((e && e.message) || e) }));
        }
      }
    },
    {
      /* 强制更新·第一步：预检会不会被别的包拦住（只扫直连依赖 + 豁免表 + 发布时长） */
      kind: "exact",
      path: "/api/ui-tweaks/precheck-exempt",
      handler: (req, res) => {
        const done = respond(res);
        if (!isLoopback(req)) { done(403, JSON.stringify({ ok: false, code: "forbidden" })); return; }
        if (req.method !== "POST") { done(405, JSON.stringify({ ok: false, code: "method not allowed" })); return; }
        readJsonBody(req, (body) => {
          const name = body && typeof body.name === "string" ? body.name : "";
          const version = body && typeof body.version === "string" ? body.version : "";
          if (!name || !version) { done(400, JSON.stringify({ ok: false, code: "name/version required" })); return; }
          const windowMs = body && isFinite(body.windowMs) && body.windowMs > 0 ? Number(body.windowMs) : 0;
          precheckExempt(name, version, { windowMs })
            .then((r) => done(r.ok ? 200 : 500, JSON.stringify(r)))
            .catch((e) => done(500, JSON.stringify({ ok: false, code: String((e && e.message) || e) })));
        });
      }
    },
    {
      /* 强制更新·第二步：把 name@version 写成豁免表里该包生效的第一条 */
      kind: "exact",
      path: "/api/ui-tweaks/force-exempt",
      handler: (req, res) => {
        const done = respond(res);
        if (!isLoopback(req)) { done(403, JSON.stringify({ ok: false, code: "forbidden" })); return; }
        if (req.method !== "POST") { done(405, JSON.stringify({ ok: false, code: "method not allowed" })); return; }
        readJsonBody(req, (body) => {
          const name = body && typeof body.name === "string" ? body.name : "";
          const version = body && typeof body.version === "string" ? body.version : "";
          if (!name || !version) { done(400, JSON.stringify({ ok: false, code: "name/version required" })); return; }
          const r = forceExemptVersion(name, version);
          done(r.ok ? 200 : 500, JSON.stringify(r));
        });
      }
    },
    {
      /* 立即重启：GET 只读方案（无副作用），POST 才执行；无法重拉时如实回 manual */
      kind: "exact",
      path: "/api/ui-tweaks/restart",
      handler: (req, res) => {
        const done = respond(res);
        if (!isLoopback(req)) { done(403, JSON.stringify({ ok: false, code: "forbidden" })); return; }
        try {
          const plan = planRestart(liveRestartFacts());
          if (req.method === "GET" || req.method === "HEAD") { done(200, JSON.stringify({ ok: true, mode: plan.mode })); return; }
          if (req.method !== "POST") { done(405, JSON.stringify({ ok: false, code: "method not allowed" })); return; }
          const mode = performRestart(plan);
          done(202, JSON.stringify({ ok: true, mode }));
        } catch (e) {
          done(500, JSON.stringify({ ok: false, code: String((e && e.message) || e) }));
        }
      }
    }
  ];

  ctx.effect(() => {
    const disposes = routes.map((r) => ctx.webServer.register(r));
    return () => { for (const d of disposes) { try { d(); } catch { /* 已释放 */ } } };
  }, "ui-tweaks: loopback routes");

  // 加载时静默收敛一次（fire-and-forget：异常绝不影响插件加载）
  try { normalizeReleaseAgeExcludes(); } catch { /* 归并自身已吞异常，这里只兜底 */ }

  // 桌面客户端：拉起窗口记忆 helper（非桌面环境内部自动不动作）
  startWindowState(ctx);
}
