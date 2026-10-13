/**
 * dsh-ui-tweaks host half.
 *
 * 两条回环路由：
 * - GET  /api/ui-tweaks/local-plugins：返回当前 profile package.json
 *   dependencies 里非 registry 直装（link:/file:/git+/github:/http）的包名清单。
 *   浏览器半区的更新面板据此把这些插件标成「本地链接」或「Git 直装」、跳过
 *   registry 比对 —— listBundles 不透传安装来源，而「npm 上恰好也发布过」的
 *   非 registry 源（如 @nimoxie/dsh-model-organizer）在客户端侧没有别的办法认。
 * - POST /api/ui-tweaks/normalize-excludes：手动触发一次下面的归并，回
 *   {ok, changed, kept, removed}；插件加载时也会静默跑一次。
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
 */
import { readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
 * 从 pnpm-lock.yaml 取「包名 → 锁定版本」。
 * importers 段（profile 自己的 dependencies）优先，packages 段兜底；
 * link:/file:/workspace: 这类没有发布版本的条目不进表（查询得到 undefined = 未锁定）。
 */
function parseLockVersions(text) {
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
  return out;
}

/**
 * 归并 profile pnpm-workspace.yaml 的 minimumReleaseAgeExclude 序列。
 * 只重排这一段的条目行，其余字节逐字节保留；无变化不写盘。
 * 任何异常都被吞掉，返回 {ok:false, code}。
 */
export function normalizeReleaseAgeExcludes() {
  let backup = null;
  try {
    const dir = findProfileDir();
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

    const lines = String(raw).split(/(?<=\n)/);   // 每行带着自己的换行符，join 即还原
    const keyRe = new RegExp("^" + EXCLUDE_KEY + "\\s*:\\s*(?:#[\\s\\S]*)?$");
    let keyLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (keyRe.test(lines[i].replace(/\r?\n$/, ""))) { keyLine = i; break; }
    }
    // 没有这个键不是错误：profile 本来就没有待归并的条目（或已被清理干净），按「无变化」回。
    if (keyLine < 0) { return { ok: true, changed: false, kept: [], removed: [], path: wsPath }; }

    const entries = [];   // {idx, raw(line), name, version}
    for (let i = keyLine + 1; i < lines.length; i++) {
      const body = lines[i].replace(/\r?\n$/, "");
      const m = /^(\s*)-\s+(\S[\s\S]*)$/.exec(body);
      if (!m || m[1].length === 0) { break; }   // 序列条目必须缩进，否则该块已结束
      const value = entryValue(m[2]);
      const nv = splitNameVersion(value);
      entries.push({ idx: i, line: lines[i], value, name: nv.name, version: nv.version });
    }
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

    // ① 写前备份（同目录，时间戳后缀）
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    backup = wsPath + ".bak-" + stamp;
    writeFileSync(backup, raw, "utf8");
    // ② 原子替换：同目录临时文件 + renameSync
    const tmp = join(dir, "." + WORKSPACE_FILE + ".tmp-" + process.pid + "-" + Date.now());
    try {
      writeFileSync(tmp, newRaw, "utf8");
      renameSync(tmp, wsPath);
    } catch (e) {
      try { unlinkSync(tmp); } catch { /* 临时文件可能未创建 */ }
      throw e;
    }
    // ③ 写后重读校验
    const after = readFileSync(wsPath, "utf8");
    if (after !== newRaw) { return { ok: false, code: "verify-mismatch", path: wsPath, backup }; }

    return { ok: true, changed: true, kept: keptInOrder, removed, path: wsPath, backup };
  } catch (e) {
    return { ok: false, code: String((e && e.message) || e) };
  }
}

export function apply(ctx) {
  const respond = (res) => (code, body) => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(body);
  };
  const isLoopback = (req) => LOOPBACK_RE.test(String((req.socket && req.socket.remoteAddress) || ""));

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
          done(200, JSON.stringify({ ok: true, local, remote, profile: (manifest && manifest.name) || "" }));
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
    }
  ];

  ctx.effect(() => {
    const disposes = routes.map((r) => ctx.webServer.register(r));
    return () => { for (const d of disposes) { try { d(); } catch { /* 已释放 */ } } };
  }, "ui-tweaks: loopback routes");

  // 加载时静默收敛一次（fire-and-forget：异常绝不影响插件加载）
  try { normalizeReleaseAgeExcludes(); } catch { /* 归并自身已吞异常，这里只兜底 */ }
}
