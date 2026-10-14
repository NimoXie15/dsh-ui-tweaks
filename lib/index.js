/**
 * dsh-ui-tweaks host half.
 *
 * 挂一条 GET /api/ui-tweaks/local-plugins：返回当前 profile package.json
 * dependencies 里非 registry 直装（link:/file:/git+/github:/http）的包名清单。
 * 浏览器半区的更新面板据此把这些插件标成「本地链接」或「Git 直装」、跳过
 * registry 比对 —— listBundles 不透传安装来源，而「npm 上恰好也发布过」的
 * 非 registry 源（如 @nimoxie/dsh-model-organizer）在客户端侧没有别的办法认。
 *
 * 纯读操作：只读 profile 的 package.json，不改任何东西；仅回环访问放行。
 *
 * 模块 6：官方桌面客户端的窗口记忆（记住主窗口上次的大小/位置/最大化状态）。
 * 官方主进程写死 1280x820 且无任何窗口状态持久化；渲染层被官方沙箱焊死
 * （contextIsolation+sandbox，dshDesktop 桥只暴露给 dsh-app://app 主框架），
 * 页面里拿不到任何窗口能力，所以这条路走插件服务端 + 进程外 Win32：
 * spawn 一个隐藏 PowerShell helper（lib/window-helper.ps1），沿父进程链找到
 * DeepSeek Harness.exe 的主窗口，趁窗口还在 show:false 的隐藏期把上次边界
 * SetWindowPos 回去（无跳动），之后每秒采样 GetWindowPlacement 持久化。
 * 仅 Windows + ELECTRON_RUN_AS_NODE=1（官方客户端内的 dsh 运行时）时激活；
 * web profile / dsh-web-shell 下自动不动作。文件落 profile 的 ui-tweaks/ 子目录。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

export function apply(ctx) {
  const route = {
    kind: "exact",
    path: "/api/ui-tweaks/local-plugins",
    handler: (req, res) => {
      const done = (code, body) => {
        res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(body);
      };
      try {
        const addr = String((req.socket && req.socket.remoteAddress) || "");
        if (!LOOPBACK_RE.test(addr)) { done(403, JSON.stringify({ ok: false, code: "forbidden" })); return; }
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
  };
  ctx.effect(() => {
    const dispose = ctx.webServer.register(route);
    return () => { try { dispose(); } catch {} };
  }, "ui-tweaks: local-plugins route");
  startWindowState(ctx);
}
