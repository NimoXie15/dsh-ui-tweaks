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
 */
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
}
