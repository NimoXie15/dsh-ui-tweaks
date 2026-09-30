/* dsh-ui-tweaks browser half.
 *
 * 三个独立模块，任一失败都不得拖垮其它（各自 guard）：
 *   1. tablefix   —— 宽表格越界修复（纯 CSS 覆盖，见 README「宽表格修复」）
 *   2. scrollbar  —— 对话区左侧自绘滚动条（从 dsh-web-shell 移植，选择器适配 0.2.x）
 *   3. updates    —— 插件更新检查面板（不含 dsh 本体；remote.pluginManager/pluginInventory）
 *
 * 装载机制：shell 的 window.__ModuleLoader__.load + factory(require)；
 * apply(ctx) 由客户端 cordis 上下文调用（同 dsh-model-organizer 的结构）。
 */
window.__ModuleLoader__.load({
  id: "@nimoxie/dsh-ui-tweaks",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;

    const BUILD = "0.1.0";

    /* 每个模块的注册各套一层 guard：失败只记 warn（座位/模块失败模式是「静默消失」，
       必须主动吭声；但不能让一个模块的异常打断同文件里其它模块的 apply）。 */
    function guard(name, fn) {
      try {
        return fn();
      } catch (e) {
        try { console.warn("[dsh-ui-tweaks:" + BUILD + "]", name, e); } catch (_) {}
        return null;
      }
    }

    /* ======================================================================
     * 模块 1：宽表格越界修复（对 dsh 本体的只读样式补丁）
     *
     * 缺陷（0.2.0-rc.1 实测仍在）：@deepseek-ai/dsh-client-ui-chat 给
     * .md-table-wide（≥4 列且不在引用块内）做了「出血」布局（width 加宽 +
     * margin-left 负值左移 + padding-left 推回），而 primitives 的
     * .tableScroll{max-width:100%} 管不住内部 width:max-content 的表格，
     * overflow-x:hidden 之下内容直接被裁（实测右沿超出可视区约 280px）。
     *
     * 修法：放弃出血，收敛回正文列 —— 同时中和 width / margin-left /
     * padding-left 三件套并放开 overflow-x（三者缺一不可，只改宽度会留下
     * 负 margin，只去 margin 不约束宽度则继续越界）。
     *
     * 防失效设计：
     *   ① 选择器用属性前缀 [class*="tableScroll"]（CSS modules「哈希_原名」，
     *      dsh 换版本改哈希也不失效，绝不硬编码 hash）；
     *   ② 全部声明带 !important 压过 dsh 自己的规则；
     *   ③ 单一 <style id> + 存在性检查，删除节点即完全回滚。
     * ==================================================================== */
    function installTableWidthFix() {
      var STYLE_ID = "dshuiw-table-width-fix";
      if (document.getElementById(STYLE_ID)) { return; }
      var st = document.createElement("style");
      st.id = STYLE_ID;
      st.setAttribute("data-dshuiw", "table-width-fix");
      st.textContent =
        "[class*=\"tableScroll\"]{" +
          "width:100%!important;" +
          "max-width:100%!important;" +
          "margin-left:0!important;" +
          "padding-left:0!important;" +
          "padding-bottom:0!important;" +
          "overflow-x:auto!important;" +
        "}" +
        /* 内部表格：允许按内容排布（保留列宽语义），宽度交给包裹层约束 */
        "[class*=\"tableScroll\"]>table{" +
          "max-width:none!important;" +
          "min-width:max-content;" +
        "}" +
        /* 滚动条尽量细、贴近 dsh 的视觉语言 */
        "[class*=\"tableScroll\"]{scrollbar-width:thin}";
      (document.head || document.documentElement).appendChild(st);
    }

    /* ======================================================================
     * 模块 2：对话区左侧自绘滚动条（自绘拇指）
     *
     * 从 dsh-web-shell 的注入脚本移植（该实现经过 A/B 实测）：
     *   · 宿主挂 document.body + position:fixed —— 挂进 React 管的容器会被
     *     「加载更早」等重渲染抹掉；fixed 还让滚动区自己滚时宿主纹丝不动。
     *   · 拖动 = PointerCapture 下的纯函数：sp.scrollTop 由拇指位置一步算出；
     *     pointermove 同步写 + scroll 捕获段回纠 + rAF 兜底（三层防御）。
     *   · 「加载更早」后 dsh 会钉阅读锚点，只有 wheel/pointerdown 等读者意图
     *     事件会解除 —— 宿主在滚动区外，pointerdown 到不了 dsh 的监听器，
     *     所以按下/滚轮时补发一个零位移 synthetic wheel（notifyReaderIntent）。
     *   · 只在「会话视图」显示：scrollport + 右侧调宽条 + 有实际高度三者齐备
     *     才保留宿主，切到插件页等非会话页自动移除。
     *   · 高度裁到输入框（composerSeat，sticky 浮在底部）上沿 −4px。
     *
     * 0.2.x 选择器适配（0.1.x 的 data-dsh-part 标记已被 dsh 全部移除）：
     *   滚动区  [data-conversation-scroll]
     *   调宽条  [class*="widthHandle"][data-side="right"]
     *   输入框  [class*="composerSeat"]
     * ==================================================================== */
    function installLeftScrollbar() {
      if (window.__DSHUIW_LEFT_SB__) { return; }
      window.__DSHUIW_LEFT_SB__ = true;
      var HOST_ID = "dshuiw-scrollbar-host";

      function findScroller() {
        return document.querySelector('[data-dsh-part="scrollport"]') ||
               document.querySelector("[data-conversation-scroll]");
      }
      function findRightHandle() {
        var hs = document.querySelectorAll('[data-dsh-part="resize-handle"]');
        for (var i = 0; i < hs.length; i++) {
          if (hs[i].getAttribute("data-side") === "right") { return hs[i]; }
        }
        /* dsh 0.2.x：宽度调整条 = widthHandle 类 + data-side（无 data-dsh-part） */
        return document.querySelector('[class*="widthHandle"][data-side="right"]');
      }
      function findComposer() {
        var c = document.querySelector('[data-dsh-part="composer-input"]');
        if (c) { return c.closest('[class*="composerSeat"]') || c; }
        return document.querySelector('[class*="composerSeat"]');
      }

      var sp = null, handle = null, host = null, track = null, thumb = null;
      var composerEl = null, ro = null;
      if (window.ResizeObserver) {
        ro = new ResizeObserver(function () { ensure(); });
      }
      var dragging = false, dragOffsetY = 0;
      var curThumbH = 40, curThumbTop = 0, curTrackH = 0;
      var trRect = null;
      var lastPointerY = 0, dragRaf = 0;

      /* 「加载更早」、切会话等操作可能换掉 scrollport 节点：交互点先校验节点
         身份，变了就重绑，否则写入落在旧节点上 —— 拖动没反应、松手弹回。 */
      function rebindIfScrollerChanged() {
        if (sp && findScroller() !== sp) { ensure(); return true; }
        return false;
      }

      function visibleHeight() {
        if (!sp) { return 0; }
        var c = findComposer();
        if (!c) { return sp.clientHeight; }
        var cr = c.getBoundingClientRect();
        var sr = sp.getBoundingClientRect();
        if (cr.top >= sr.bottom - 2) { return sp.clientHeight; }
        var v = cr.top - sr.top - 4;
        return (v > 80 && v < sp.clientHeight) ? v : sp.clientHeight;
      }

      function build() {
        host = document.createElement("div");
        host.id = HOST_ID;
        host.style.width = "14px";
        var sr = host.attachShadow({ mode: "open" });
        sr.innerHTML = "<style>" +
          ":host{position:fixed;z-index:6}" +
          ".track{position:absolute;top:0;right:0;width:100%;height:100%;" +
          "user-select:none;-webkit-user-select:none;touch-action:none}" +
          ".track[hidden]{display:none}" +
          ".thumb{position:absolute;right:0;width:100%;background:transparent}" +
          ".thumb::after{content:\"\";position:absolute;top:0;bottom:0;right:3px;width:7px;border-radius:4px;" +
          "background:rgba(128,128,128,.4);" +
          "background:color-mix(in srgb,currentColor 32%,transparent);" +
          "transition:width .12s,right .12s,background .12s}" +
          ".track:hover .thumb::after,.thumb.drag::after{right:2px;width:9px;" +
          "background:rgba(128,128,128,.62);" +
          "background:color-mix(in srgb,currentColor 55%,transparent)}" +
          "</style><div class=\"track\" hidden><div class=\"thumb\"></div></div>";
        track = sr.querySelector(".track");
        thumb = sr.querySelector(".thumb");
        wireEvents();
        document.body.appendChild(host);
      }

      /* thumb 几何：高 = 轨道 × 可见比，位置 = scrollTop / scrollHeight */
      function render() {
        if (!sp || !track || !thumb) { return; }
        track.hidden = false;
        var range = sp.scrollHeight - sp.clientHeight;
        var th = track.clientHeight;
        if (range <= 0 || th <= 0) { track.hidden = true; return; }
        curTrackH = th;
        curThumbH = Math.round(th * sp.clientHeight / sp.scrollHeight);
        if (curThumbH < 28) { curThumbH = 28; }
        if (curThumbH > th) { curThumbH = th; }
        curThumbTop = Math.round(th * sp.scrollTop / sp.scrollHeight);
        if (curThumbTop > th - curThumbH) { curThumbTop = th - curThumbH; }
        if (curThumbTop < 0) { curThumbTop = 0; }
        if (thumb.style.height !== curThumbH + "px") { thumb.style.height = curThumbH + "px"; }
        if (thumb.style.top !== curThumbTop + "px") { thumb.style.top = curThumbTop + "px"; }
      }

      /* 补发零位移 wheel 作纯阅读意图：解除 dsh 的阅读锚点保留（stopPreserving），
         否则「加载更早」后拖动会被判成程序化滚动、松手弹回锚点。 */
      function notifyReaderIntent() {
        if (!sp) { return; }
        var targets = [sp];
        try {
          var outer = sp.closest("[data-conversation-scroll]");
          if (outer && outer !== sp) { targets.push(outer); }
        } catch (e) {}
        for (var i = 0; i < targets.length; i++) {
          try {
            targets[i].dispatchEvent(new WheelEvent("wheel", { deltaY: 0, bubbles: false, cancelable: true }));
          } catch (e) {}
        }
      }

      /* 三层防御共用的纯函数：pointermove 同步写 + scroll 捕获段回纠 + rAF 兜底 */
      function applyDrag() {
        if (!dragging || !sp || !track || !trRect) { return; }
        var top = lastPointerY - dragOffsetY - trRect.top;
        var maxTop = curTrackH - curThumbH;
        if (maxTop <= 0) { return; }
        if (top < 0) { top = 0; }
        if (top > maxTop) { top = maxTop; }
        var want = top / curTrackH * sp.scrollHeight;
        if (Math.abs(sp.scrollTop - want) > 0.5) { sp.scrollTop = want; }
        render();
      }

      function wireEvents() {
        track.addEventListener("pointerdown", function (e) {
          if (!sp || !track) { return; }
          rebindIfScrollerChanged();
          if (!sp || !track) { return; }
          trRect = track.getBoundingClientRect();
          var tR = thumb.getBoundingClientRect();
          if (e.clientY >= tR.top && e.clientY <= tR.bottom) {
            dragging = true;
            dragOffsetY = e.clientY - tR.top;
          } else {
            /* 点轨道 = 标准翻页：拇指中心跳到点击处，顺势进入拖动 */
            var top0 = e.clientY - trRect.top - curThumbH / 2;
            var maxTop0 = curTrackH - curThumbH;
            if (top0 < 0) { top0 = 0; }
            if (top0 > maxTop0) { top0 = maxTop0; }
            sp.scrollTop = top0 / curTrackH * sp.scrollHeight;
            curThumbTop = top0;
            dragging = true;
            dragOffsetY = e.clientY - (trRect.top + curThumbTop);
          }
          lastPointerY = e.clientY;
          notifyReaderIntent();
          thumb.classList.add("drag");
          try { track.setPointerCapture(e.pointerId); } catch (err) {}
          e.preventDefault();
          render();
          startDragTick();
        });
        track.addEventListener("pointermove", function (e) {
          if (!dragging || !sp || !track || !trRect) { return; }
          lastPointerY = e.clientY;
          if (rebindIfScrollerChanged()) { trRect = track.getBoundingClientRect(); }
          applyDrag();
        });
        function release(e) {
          if (!dragging) { return; }
          dragging = false;
          trRect = null;
          if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }
          thumb.classList.remove("drag");
          try { track.releasePointerCapture(e.pointerId); } catch (err) {}
        }
        function startDragTick() {
          if (dragRaf) { cancelAnimationFrame(dragRaf); }
          var tick = function () {
            if (!dragging) { dragRaf = 0; return; }
            rebindIfScrollerChanged();
            applyDrag();
            dragRaf = requestAnimationFrame(tick);
          };
          dragRaf = requestAnimationFrame(tick);
        }
        track.addEventListener("pointerup", release);
        track.addEventListener("pointercancel", release);
        /* 悬停在条上时滚轮转发给真容器（同样补发阅读意图） */
        host.addEventListener("wheel", function (e) {
          if (!sp) { return; }
          rebindIfScrollerChanged();
          if (!sp) { return; }
          e.preventDefault();
          notifyReaderIntent();
          sp.scrollTop += e.deltaY;
          render();
        }, { passive: false });
      }

      function place() {
        if (!host || !sp) { return; }
        var q = sp.getBoundingClientRect();
        var top = Math.round(q.top), h = Math.round(visibleHeight());
        var edge = handle ? handle.getBoundingClientRect().left : q.right;
        var left = Math.round(edge - host.offsetWidth);
        if (host.style.top !== top + "px") { host.style.top = top + "px"; }
        if (host.style.height !== h + "px") { host.style.height = h + "px"; }
        if (host.style.left !== left + "px") { host.style.left = left + "px"; }
      }

      /* scroll 捕获段监听（scroll 不冒泡但下传捕获段），对节点替换天然免疫；
         拖动期间还负责把非本脚本的 scrollTop 写动立刻纠正回来。 */
      function onDocScroll(e) {
        if (!sp || e.target !== sp) { return; }
        if (dragging) { applyDrag(); } else { render(); }
      }
      document.addEventListener("scroll", onDocScroll, { capture: true, passive: true });

      function ensure() {
        var found = findScroller();
        if (found !== sp) { sp = found; }
        var hFound = findRightHandle();
        if (hFound !== handle) {
          if (handle) { try { handle.removeEventListener("pointermove", place); } catch (e) {} }
          handle = hFound;
          if (handle) { try { handle.addEventListener("pointermove", place, { passive: true }); } catch (e) {} }
        }
        /* 只在会话视图显示：scrollport + 调宽条 + 实际高度三者齐备；
           否则移除宿主（切到插件页等非会话页不留残影）。 */
        var spVisible = !!(sp && sp.isConnected && sp.getBoundingClientRect().height > 0);
        if (!spVisible || !handle) {
          if (host) {
            try { host.remove(); } catch (e) {}
            host = null; track = null; thumb = null;
            dragging = false;
            dragOffsetY = 0;
            if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }
          }
          return;
        }
        if (!host || !host.isConnected) {
          if (host) { try { host.remove(); } catch (e) {} }
          host = null; track = null; thumb = null;
          build();
        }
        if (ro) {
          try { ro.observe(sp); } catch (e) {}
          var ce = findComposer();
          if (ce !== composerEl) {
            if (composerEl) { try { ro.unobserve(composerEl); } catch (e) {} }
            composerEl = ce;
            if (composerEl) { try { ro.observe(composerEl); } catch (e) {} }
          }
        }
        place();
        render();
      }

      ensure();
      /* 700ms 兜底轮询：补挂 / 高度 / 落点；不用全文档 MutationObserver
         （流式输出每帧都有 mutation，ensure 读 rect 会强制布局）。 */
      setInterval(ensure, 700);
      window.addEventListener("resize", ensure);
    }

    /* ======================================================================
     * 模块 3：插件更新检查面板（不含 dsh 本体 —— 桌面端自带更新器，
     * web 端本体升级走 npm，都不归这个插件管）
     *
     * 全部走官方 remote API，不自建 host 路由：
     *   remote.pluginManager.listBundles()   → 已装插件包（name/version/installed）
     *   remote.pluginManager.installBundle(spec, {enabled, requestId}) → 更新
     *   remote.pluginManager.waitForInstall(requestId) → 安装进度轮询
     *   remote.pluginManager.cancelInstall(requestId)  → 取消
     * registry 比对从浏览器直连（registry.npmjs.org 带 CORS *）。
     *
     * 更新严格串行（pnpm 对 profile 的 package.json 有文件锁，并发只会在锁上
     * 排队）；安装 spec 用面板解析出的**精确版本**（`name@版本`，不是 @latest）：
     * pnpm 11 的 minimumReleaseAge 门禁只拦「最新版本」解析，显式版本会自动
     * 写入 profile 的 pnpm-workspace.yaml 的 minimumReleaseAgeExclude 并放行。
     * 装完仍回读实际版本兜底（registry 与 pnpm 解析可能不一致），版本没变
     * 才是「暂缓更新」。
     * ==================================================================== */
    function installPluginUpdates(ctx) {
      if (window.__DSHUIW_UPDATES__) { return; }
      window.__DSHUIW_UPDATES__ = true;
      var BTN_ID = "dshuiw-updates-btn-host";
      var PANEL_ID = "dshuiw-updates-panel-host";
      var POS_KEY = "dshuiw-updates-panel-pos";

      /* ---- semver 比较（rc 比数字/字母、正式版 > 预发布版；字符串比会把
         rc.9 判成大于 rc.10，必须自己实现）---- */
      function cmpSemver(a, b) {
        function parse(v) {
          var m = String(v == null ? "" : v).trim().replace(/^v/, "")
            .match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
          if (!m) { return null; }
          return { core: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split(".") : null };
        }
        var pa = parse(a), pb = parse(b);
        if (!pa || !pb) { return String(a) === String(b) ? 0 : (String(a) < String(b) ? -1 : 1); }
        for (var i = 0; i < 3; i++) {
          if (pa.core[i] !== pb.core[i]) { return pa.core[i] < pb.core[i] ? -1 : 1; }
        }
        var ha = pa.pre === null, hb = pb.pre === null;
        if (ha && hb) { return 0; }
        if (ha) { return 1; }
        if (hb) { return -1; }
        for (var j = 0; j < Math.max(pa.pre.length, pb.pre.length); j++) {
          var x = pa.pre[j], y = pb.pre[j];
          if (x === undefined) { return -1; }
          if (y === undefined) { return 1; }
          var xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
          if (xn && yn) { var d = +x - +y; if (d) { return d < 0 ? -1 : 1; } }
          else if (xn) { return -1; }
          else if (yn) { return 1; }
          else if (x !== y) { return x < y ? -1 : 1; }
        }
        return 0;
      }

      function uuid() {
        try { if (crypto && crypto.randomUUID) { return crypto.randomUUID(); } } catch (e) {}
        return "req-" + Date.now() + "-" + Math.random().toString(36).slice(2);
      }
      function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
          return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c];
        });
      }

      /* ---- remote 服务解析：ctx.inject 的 scope 优先（缓存复用），超时兜底直读 ctx ---- */
      var savedScope = null;
      var got = null;             // checkNow 的服务句柄缓存（{pm}）
      function pickService(scope, dotted) {
        var cands = [];
        var s = scope || savedScope;
        if (s) {
          cands.push(s[dotted]);
          var root = dotted.split(".")[0];
          if (s[root]) { cands.push(s[root][dotted.split(".")[1]]); }
        }
        cands.push(ctx && ctx[dotted]);
        if (ctx) {
          var root2 = dotted.split(".")[0];
          if (ctx[root2]) { cands.push(ctx[root2][dotted.split(".")[1]]); }
        }
        for (var i = 0; i < cands.length; i++) { if (cands[i]) { return cands[i]; } }
        return null;
      }

      function fetchLatest(name) {
        var path = String(name).split("/").map(encodeURIComponent).join("/");
        return fetch("https://registry.npmjs.org/" + path + "/latest", { cache: "no-store" })
          .then(function (r) {
            if (r.status === 404) {
              /* npm 上没有这个包：本地直装（link:/file:）或尚未发布 —— 不是「检查失败」。
                 官方 listBundles 不透传安装来源，404 就是本地包的唯一可靠签名。 */
              var e404 = new Error("npm 上查不到此包（未发布或本地直装）");
              e404.notFound = true;
              throw e404;
            }
            if (!r.ok) { throw new Error("HTTP " + r.status); }
            return r.json();
          })
          .then(function (d) { return d && d.version ? String(d.version) : null; });
      }

/* 非 registry 直装（link:/file:/git+/github:/http）没有可比的 registry 版本。
       * 来源判定主路径是 host 半区的 /api/ui-tweaks/local-plugins（读 profile
       * 依赖声明）：本地路径（link:/file:）与仓库/URL 直装（git/github/http）分列，
       * host 未重启/路由不可用时退回 registry 404 签名。 */
      function fetchLocalNames(cb) {
        fetch("/api/ui-tweaks/local-plugins", { cache: "no-store" })
          .then(function (r) { if (!r.ok) { throw new Error("HTTP " + r.status); } return r.json(); })
          .then(function (d) {
            cb({
              local: d && d.ok && Array.isArray(d.local) ? d.local : [],
              remote: d && d.ok && Array.isArray(d.remote) ? d.remote : []
            });
          })
          .catch(function () { cb({ local: [], remote: [] }); });
      }
      function isLocalSrc(src) { return /^(link:|file:)/.test(String(src || "")); }
      function isRemoteSrc(src) { return /^(git[+:@]|github:|git:|http)/.test(String(src || "")); }

      /* ---- 面板状态 ---- */
      var rows = [];              // {name, version, latest, state, why}
      // state: pending | checking | current | update | local | remote | error | queuing | busy | done | unchanged
      var queue = [];             // 待更新名单（串行队列）
      var busyName = "";          // 正在更新的那个
      var busyReq = "";
      var cancelling = false;
      var checking = false;
      var listeners = [];         // 面板重绘订阅（面板未开时也维护状态）

      function emit() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](); } catch (e) {} } }

      function setRow(name, patch) {
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].name === name) { for (var k in patch) { rows[i][k] = patch[k]; } break; }
        }
        emit();
      }

      /* 404 签名兜底：npm 上没有此包 → 按来源分「本地链接」/「Git 直装」；
         host 半区未重启时走到这里。 */
      function notFoundState(row) {
        return isLocalSrc(row.src) ? "local" : (isRemoteSrc(row.src) ? "remote" : "local");
      }

      function checkNow() {
        if (checking) { return; }
        checking = true;
        rows = [];
        emit();
        var pm = null;
        // 服务句柄在回调里现取（ctx.inject 服务齐了才回调，可能异步；waitScope 轮询等待）
        if (!got) {
          ctx.inject(["remote", "remote.pluginManager", "remote.pluginInventory"], function (s) {
            savedScope = s;
            got = { pm: pickService(s, "remote.pluginManager") };
          });
        }
        var started = Date.now();
        function waitScope() {
          if (!got && Date.now() - started < 8000) { setTimeout(waitScope, 150); return; }
          if (!got || !got.pm) {
            rows = [{ name: "（插件清单服务不可用）", version: "", latest: "", state: "error", why: "remote.pluginManager 未就绪；请升级 dsh 或稍后重试" }];
            checking = false; emit(); return;
          }
          pm = got.pm;
          Promise.all([pm.listBundles(), pm.listPlugins()])
            .then(function (r) {
              var bundles = (r[0] && r[0].ok && r[0].value) || [];
              var plugins = (r[1] && r[1].ok && r[1].value) || [];
              if (!bundles.length && plugins.length) { bundles = plugins; }
              rows = bundles.map(function (b) {
                var name = b.name || b.id || "";
                var ver = b.version != null ? String(b.version) : (b.installedVersion != null ? String(b.installedVersion) : "");
                var src = typeof b.installed === "string" ? b.installed : (typeof b.source === "string" ? b.source : "");
                return {
                  name: name, version: ver, latest: "",
                  state: isLocalSrc(src) ? "local" : (isRemoteSrc(src) ? "remote" : (ver ? "checking" : "unknown")),
                  src: src, why: ""
                };
              }).filter(function (x) { return x.name; })
              /* 官方 @deepseek-ai 插件由 dsh 本体更新流程负责，直接从检查列表里剔除 */
              .filter(function (x) { return !/^@deepseek-ai\//.test(x.name); });
              checking = false;
              emit();
              // 先向 host 半区要非 registry 直装名单，命中的行直接标「本地链接」或「Git 直装」
              // 不进比对 —— 已发布到 npm 的本地/仓库源（如 @nimoxie/dsh-model-organizer、
              // dsh-ego-browser）靠它认出；host 未重启（无路由）时名单为空，退回
              // registry 404 签名判定。
              fetchLocalNames(function (srcs) {
                var localSet = {}, remoteSet = {};
                (srcs.local || []).forEach(function (n) { localSet[n] = true; });
                (srcs.remote || []).forEach(function (n) { remoteSet[n] = true; });
                rows.forEach(function (row) {
                  if (localSet[row.name] && row.state === "checking") {
                    row.state = "local";
                    row.why = "profile 依赖声明为本地路径，不参与 registry 比对";
                  } else if (remoteSet[row.name] && row.state === "checking") {
                    row.state = "remote";
                    row.why = "profile 依赖声明为 git/URL 直装，不参与 registry 比对";
                  }
                });
                emit();
                // 逐个查 registry（串行，别对 registry 打并发）
                var chain = Promise.resolve();
                rows.forEach(function (row) {
                  if (row.state !== "checking") { return; }
                  chain = chain.then(function () {
                    return fetchLatest(row.name).then(function (v) {
                      row.latest = v || "";
                      row.state = v && cmpSemver(v, row.version) > 0 ? "update" : "current";
                      emit();
                    }).catch(function (e) {
                      row.state = e && e.notFound ? notFoundState(row) : "error";
                      row.why = String(e && e.message || e);
                      emit();
                    });
                  });
                });
              });
            })
            .catch(function (e) {
              rows = [{ name: "（读取插件清单失败）", version: "", latest: "", state: "error", why: String(e && e.message || e) }];
              checking = false; emit();
            });
        }
        waitScope();
      }

      /* ---- 更新执行：串行队列；装完回读实际版本判定真实结果 ---- */
      function enqueue(name) {
        if (busyName) {
          if (queue.indexOf(name) < 0 && name !== busyName) { queue.push(name); setRow(name, { state: "queuing" }); }
          return;
        }
        queue.push(name);
        pump();
      }
      function pump() {
        var name = queue.shift();
        if (!name) { return; }
        startOne(name);
      }
      function startOne(name) {
        busyName = name;
        busyReq = uuid();
        setRow(name, { state: "busy" });
        emit();
        var pm = pickService(null, "remote.pluginManager");
        if (!pm) { finishOne(name, false, "remote.pluginManager 不可用"); return; }
        var settled = false;
        function finish(ok, why) {
          if (settled) { return; }
          settled = true;
          finishOne(name, ok, why || "");
        }
/* 安装 spec 用面板已解析的精确版本（`name@版本`）而不是 @latest：
         * pnpm 11 的 minimumReleaseAge 门禁只拦「最新版本」解析 —— 发布不足
         * 24h 的新版会被静默跳过、回落到旧版；显式版本则会触发 pnpm 的
         * minimumReleaseAgeExclude 自动豁免并照常安装（社区分叉版
         * @linxin666/dsh-client-ui-plugin-manager 的 update 正是这样：先
         * fetchManifest 拿 registry 的 version，再按 `id@版本` 安装）。
         * 行内没解析过（没点过检查）则现场查 registry，仍失败退回 @latest。 */
        var row = null;
        for (var i = 0; i < rows.length; i++) { if (rows[i].name === name) { row = rows[i]; break; } }
        var specPromise = (row && row.latest)
          ? Promise.resolve(name + "@" + row.latest)
          : fetchLatest(name)
              .then(function (v) { return v ? name + "@" + v : name + "@latest"; })
              .catch(function () { return name + "@latest"; });
        specPromise.then(function (spec) {
          try {
            pm.installBundle(spec, { enabled: true, requestId: busyReq })
              .then(function (res) {
                if (!res || res.ok === false) {
                  finish(false, (res && res.failure && (res.failure.message || res.failure.reason)) || (res && res.message) || "安装请求被拒");
                  return;
                }
                /* 轮询进度；终态形态未知，多形状都认，240s 兜底 */
                var t0 = Date.now();
                function poll() {
                  var done = false;
                  try {
                    var p = pm.waitForInstall ? pm.waitForInstall(busyReq) : null;
                    Promise.resolve(p).then(function (st) {
                      var ph = st && (st.phase || st.state || st.status);
                      if (ph === "done" || ph === "completed" || ph === "finished" || (st && st.ok === true)) { done = true; finish(true, ""); }
                      else if (ph === "failed" || ph === "error" || ph === "cancelled" || (st && st.ok === false)) {
                        finish(false, (st && st.failure && (st.failure.message || st.failure.reason)) || "安装失败");
                      }
                    }).catch(function () { /* 轮询失败不作为终态 */ });
                  } catch (e) {}
                  if (!done && !settled && Date.now() - t0 < 240000) { setTimeout(poll, 900); }
                  else if (!settled && Date.now() - t0 >= 240000) { finish(false, "更新超时（240 秒未结束）"); }
                }
                poll();
              })
              .catch(function (e) { finish(false, String(e && e.message || e)); });
          } catch (e) { finish(false, String(e && e.message || e)); }
        });
      }
/* 装完回读清单：版本变了才算真的装上——安装走精确版本后 pnpm 已不会因
       * minimumReleaseAge 拦新版本，但如果 registry 与 pnpm 解析不一致（如
       * profile 配了镜像源），仍可能装回旧版，所以回读判据保留作最后兜底。
       * 只用 pluginManager.listBundles —— pluginInventory 没有 listBundles 方法
       * （只有 list()），之前先取 inventory 导致 guard 落到 reject，面板上的
       * 「安装已发起，但回读版本失败」假阳性就是它。装完瞬间清单可能短暂
       * 不可用，重试 3 次（间隔 1.5s）再下结论。 */
      function finishOne(name, ok, why) {
        var before = null;
        for (var i = 0; i < rows.length; i++) { if (rows[i].name === name) { before = rows[i].version; break; } }
        var pm = pickService(null, "remote.pluginManager");
        function done() {
          busyName = ""; busyReq = ""; cancelling = false;
          emit();
          pump();
        }
        function attempt(n) {
          if (!pm || !pm.listBundles) {
            setRow(name, ok ? { state: "unconfirmed", why: "安装已发起；清单服务不可用，未能回读版本" } : { state: "error", why: why || "更新失败" });
            done();
            return;
          }
          Promise.resolve(pm.listBundles()).then(function (r) {
            var bundles = (r && r.ok && r.value) || [];
            var ver = "";
            for (var i = 0; i < bundles.length; i++) {
              if (bundles[i].name === name) { ver = bundles[i].version != null ? String(bundles[i].version) : ""; break; }
            }
            if (!bundles.length && n < 3) { setTimeout(function () { attempt(n + 1); }, 1500); return; }
            if (ver) {
              if (before && ver === before) {
                setRow(name, { state: "unchanged", why: "版本未变化：可能 registry 解析与 pnpm 实际安装不一致（如配置了镜像源），也可能检查时远端版本信息有误" });
              } else {
                setRow(name, { version: ver, state: "current", latest: ver, why: "" });
              }
            } else if (ok) {
              setRow(name, { state: "unconfirmed", why: "安装已发起，但清单里没读到它；点击重查确认" });
            } else {
              setRow(name, { state: "error", why: why || "更新失败" });
            }
            done();
          }).catch(function () {
            if (n < 3) { setTimeout(function () { attempt(n + 1); }, 1500); return; }
            setRow(name, ok ? { state: "unconfirmed", why: "安装已发起，但回读版本失败；点击重查确认" } : { state: "error", why: why || "更新失败" });
            done();
          });
        }
        attempt(0);
      }
      function requestCancel() {
        if (!busyName || cancelling) { return; }
        cancelling = true;
        queue = [];
        rows.forEach(function (r) { if (r.state === "queuing") { r.state = r.latest && cmpSemver(r.latest, r.version) > 0 ? "update" : "current"; } });
        var pm = pickService(null, "remote.pluginManager");
        try { if (pm && pm.cancelInstall && busyReq) { pm.cancelInstall(busyReq); } } catch (e) {}
        setRow(busyName, { state: "error", why: "已请求取消" });
        emit();
      }

      /* ---- 面板 UI：挂在 body 的 Shadow DOM（fixed 浮层不能放进 flex 工具栏）---- */
      function panelWrap() {
        var host = document.getElementById(PANEL_ID);
        if (host && host.shadowRoot) { return host.shadowRoot.querySelector(".wrap"); }
        if (host) { host.remove(); }
        host = document.createElement("div");
        host.id = PANEL_ID;
        document.body.appendChild(host);
        var sr = host.attachShadow({ mode: "open" });
        sr.innerHTML = "<style>" +
          ".wrap{position:fixed;top:56px;right:16px;z-index:2147483000;width:344px;display:flex;" +
          "flex-direction:column;max-height:64vh;overflow:hidden;border-radius:12px;" +
          "border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.32));" +
          "background:var(--dsw-alias-bg-base,#1b1d23);color:var(--dsw-alias-label-primary,#e8e9ec);" +
          "box-shadow:0 10px 30px rgba(0,0,0,.34);" +
          "font:13px/1.55 system-ui,-apple-system,\"Microsoft YaHei UI\",sans-serif}" +
          ".wrap[hidden]{display:none}" +
          ".hd{display:flex;align-items:center;gap:8px;padding:10px 12px;flex:0 0 auto;" +
          "border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.22));" +
          "cursor:move;user-select:none;-webkit-user-select:none}" +
          ".hd b{flex:1;font-size:13px;font-weight:600}" +
          ".x{cursor:pointer;opacity:.55;font-size:17px;line-height:1;padding:0 3px}" +
          ".x:hover{opacity:1}" +
          ".rows{flex:1 1 auto;min-height:0;overflow:auto}" +
          ".row{display:flex;align-items:center;gap:8px;padding:7px 12px;" +
          "border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.12))}" +
          ".row:last-child{border-bottom:0}" +
          ".nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
          ".ver{opacity:.6;font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums}" +
          ".tag{font-size:11px;padding:1px 7px;border-radius:999px;white-space:nowrap;" +
          "border:1px solid transparent;flex:0 0 auto;cursor:not-allowed}" +
          ".tag.update{background:rgba(255,138,0,.16);color:#f0a35e;border-color:rgba(255,138,0,.32)}" +
          ".tag.current{background:rgba(62,207,142,.14);color:#4fbf8b;border-color:rgba(62,207,142,.28)}" +
          ".tag.other{background:rgba(128,128,128,.14);opacity:.85}" +
          ".tag.busy{opacity:.6}" +
          ".tag.error{background:rgba(255,80,80,.14);color:#e07070;border-color:rgba(255,80,80,.28)}" +
          ".tag.clickable{cursor:pointer}" +
          ".tag.clickable:hover{filter:brightness(1.15)}" +
          ".allbtn{cursor:pointer;font-size:12px;padding:2px 9px;border-radius:6px;flex:0 0 auto;" +
          "border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4))}" +
          ".allbtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14))}" +
          ".allbtn[hidden]{display:none}" +
          ".recheck{cursor:pointer;font-size:12px;padding:2px 9px;border-radius:6px;flex:0 0 auto;" +
          "border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));opacity:.85}" +
          ".recheck:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));opacity:1}" +
          ".msg{padding:10px 12px;white-space:pre-wrap;word-break:break-word;opacity:.85}" +
          "</style><div class=\"wrap\" hidden></div>";
        var wrap = sr.querySelector(".wrap");

        /* 拖拽（记 localStorage，重载回原位） */
        try {
          var saved = localStorage.getItem(POS_KEY);
          if (saved) {
            var a = saved.split(",");
            if (isFinite(+a[0]) && isFinite(+a[1])) { wrap.style.left = a[0] + "px"; wrap.style.top = a[1] + "px"; wrap.style.right = "auto"; }
          }
        } catch (e) {}
        sr.addEventListener("pointerdown", function (e) {
          var t = e.target;
          if (!t || !t.closest || !t.closest(".hd") || t.closest(".x") || t.closest(".allbtn")) { return; }
          var r = wrap.getBoundingClientRect();
          var offX = e.clientX - r.left, offY = e.clientY - r.top;
          e.preventDefault();
          function clamp(x, y, w, h) {
            return { x: Math.min(Math.max(0, x), Math.max(0, window.innerWidth - w)),
                     y: Math.min(Math.max(0, y), Math.max(0, window.innerHeight - h)) };
          }
          function onMove(ev) {
            var w = wrap.getBoundingClientRect().width || 344, h = wrap.getBoundingClientRect().height || 220;
            var p = clamp(ev.clientX - offX, ev.clientY - offY, w, h);
            wrap.style.left = p.x + "px"; wrap.style.top = p.y + "px"; wrap.style.right = "auto";
            try { localStorage.setItem(POS_KEY, p.x + "," + p.y); } catch (e2) {}
          }
          function onUp() {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
          }
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
          window.addEventListener("pointercancel", onUp);
        });

        /* 点击外部收起（捕获段，按下即收） */
        document.addEventListener("pointerdown", function (e) {
          var w = document.getElementById(PANEL_ID);
          if (w !== host) { return; }
          var cur = host.shadowRoot.querySelector(".wrap");
          if (!cur || cur.hidden) { return; }
          if (host.contains(e.target)) { return; }
          cur.hidden = true;
        }, true);
        document.addEventListener("keydown", function (e) {
          if (e.key !== "Escape") { return; }
          var cur = host.shadowRoot.querySelector(".wrap");
          if (cur) { cur.hidden = true; }
        });

        /* 行内点击委托：有新版本 → 入队；更新中/等待 → 取消；失败 → 重试 */
        wrap.addEventListener("click", function (e) {
          var t = e.target;
          if (!t || !t.classList) { return; }
          if (t.classList.contains("x")) { wrap.hidden = true; return; }
          if (t.classList.contains("recheck")) { if (!checking) { checkNow(); } return; }
          if (t.classList.contains("reverify")) { if (!checking) { checkNow(); } return; }
          if (t.classList.contains("allbtn")) {
            rows.forEach(function (r) { if (r.state === "update" && queue.indexOf(r.name) < 0 && r.name !== busyName) { enqueue(r.name); } });
            return;
          }
          if (t.classList.contains("act")) {
            var nm = t.getAttribute("data-n");
            if (nm) { enqueue(nm); }
            return;
          }
          if (t.classList.contains("cancel")) { requestCancel(); return; }
          if (t.classList.contains("retry")) {
            var nm2 = t.getAttribute("data-n");
            checkOne(nm2);
          }
        });

        /* 状态 → 行渲染订阅 */
        listeners.push(function () { paint(); });
        return wrap;
      }

      function checkOne(name) {
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].name === name) {
            var cur = rows[i];
            cur.state = "checking"; cur.why = "";
            emit();
            fetchLatest(name).then(function (v) {
              var r = null;
              for (var j = 0; j < rows.length; j++) { if (rows[j].name === name) { r = rows[j]; break; } }
              if (!r) { return; }
              r.latest = v || "";
              r.state = v && cmpSemver(v, r.version) > 0 ? "update" : "current";
              emit();
            }).catch(function (e) {
              setRow(name, e && e.notFound ? { state: notFoundState(cur), why: String(e.message) } : { state: "error", why: String(e && e.message || e) });
            });
            return;
          }
        }
      }

      var TAG_TEXT = {
        checking: "比对中 …", current: "已是最新", update: "有新版本",
        local: "本地链接", remote: "Git 直装", unknown: "无法比对", error: "检查失败", queuing: "等待更新",
        busy: "更新中 …", unchanged: "暂缓更新", unconfirmed: "已发起·未确认"
      };
      function tagHtml(r) {
        var cls = "tag other", act = "", title = "";
        if (r.state === "update") { cls = "tag update act clickable"; act = " data-n=\"" + esc(r.name) + "\""; title = " title=\"点击更新到最新版\""; }
        else if (r.state === "current") { cls = "tag current"; }
        else if (r.state === "error") { cls = "tag error retry clickable"; act = " data-n=\"" + esc(r.name) + "\""; title = " title=\"" + esc(r.why || "检查失败") + "（点击重查）\""; }
        else if (r.state === "local") { title = " title=\"" + esc(r.src || r.why || "本地直装") + "；没有可比的 registry 版本\""; }
        else if (r.state === "remote") { title = " title=\"" + esc(r.src || r.why || "Git/URL 直装") + "；没有可比的 registry 版本\""; }
        else if (r.state === "unknown") { title = " title=\"" + esc(r.why || "插件清单未提供已装版本") + "，因此无法与 registry 比对\""; }
        else if (r.state === "queuing" || r.state === "busy") { cls = "tag other cancel clickable"; title = " title=\"点击取消" + (r.state === "busy" ? "本次更新" : "排队") + "\""; }
        else if (r.state === "unchanged") { cls = "tag update act clickable"; act = " data-n=\"" + esc(r.name) + "\""; title = " title=\"" + esc(r.why || "") + "（点击重试）\""; }
        else if (r.state === "unconfirmed") { cls = "tag other reverify clickable"; title = " title=\"" + esc(r.why || "") + "（点击重查）\""; }
        return "<span class=\"" + cls + "\"" + act + title + ">" + esc(TAG_TEXT[r.state] || "未比对") + "</span>";
      }
      function paint() {
        var wrap = panelWrap();
        var upd = 0;
        rows.forEach(function (r) { if (r.state === "update") { upd++; } });
        var allBtn = upd ? "<span class=\"allbtn\">全部更新（" + upd + "）</span>" : "<span class=\"allbtn\" hidden></span>";
        var body;
        if (!rows.length) {
          body = "<div class=\"msg\">" + (checking ? "正在读取插件清单…" : "点上方「重新检查」开始比对") + "</div>";
        } else {
          body = rows.map(function (r) {
            var ver = r.latest && (r.state === "update" || r.state === "unchanged") ? r.version + " → " + r.latest : r.version;
            return "<div class=\"row\">" +
              "<span class=\"nm\" title=\"" + esc(r.name) + "\">" + esc(r.name) + "</span>" +
              "<span class=\"ver\" title=\"" + esc(ver) + "\">" + esc(ver) + "</span>" +
              tagHtml(r) + "</div>";
          }).join("");
        }
        var html = "<div class=\"hd\"><b>插件更新 · " + (busyName ? "正在更新 " + esc(busyName) + " …" : (checking ? "检查中…" : (rows.length ? upd + " 个插件有新版本" : "插件更新检查"))) + "</b>" +
          "<span class=\"recheck\" title=\"重新读取插件清单并比对 registry\">重新检查</span>" + allBtn +
          "<span class=\"x\" title=\"关闭\">×</span></div><div class=\"rows\">" + body + "</div>";
        if (wrap.innerHTML !== html) {
          var keep = wrap.querySelector(".rows");
          var st = keep ? keep.scrollTop : 0;
          wrap.innerHTML = html;
          var nk = wrap.querySelector(".rows");
          if (nk && st) { nk.scrollTop = st; }
        }
        wrap.hidden = false;
      }

      /* ---- 入口按钮：挂官方插件页顶栏（刷新按钮左侧），样式克隆「添加
         插件」按钮。官方类名是 CSS-module hash（不硬编码），按钮在官方
         页面渲染后由 findToolbar 实时克隆出来，换版本也不破。刷新按钮
         与添加按钮同处一个 toolbar 容器，用文案「添加插件/Add plugin」
         定位该容器，再插到容器首位（刷新按钮之前），保持既有更新面板。
         React 重渲染会抹掉手插节点，MO + 轮询兜底补挂。---- */
      function mountButton(openPanel) {
        function findToolbar() {
          var panel = document.querySelector('[data-plugin-panel]');
          if (!panel) { return null; }
          var header = panel.querySelector("header");
          if (!header) { return null; }
          var add = null;
          var btns = header.querySelectorAll("button");
          for (var i = 0; i < btns.length; i++) {
            var t = String(btns[i].textContent || "").trim();
            /* 「添加插件」在安装进行中会变成「查看安装任务」，两种都要认 */
            if (t === "添加插件" || t === "Add plugin" || t === "查看安装任务" || t === "View installation") { add = btns[i]; break; }
          }
          if (!add || !add.parentElement) { return null; }
          return { toolbar: add.parentElement, addBtn: add };
        }
        function mount() {
          var found = findToolbar();
          var host = document.getElementById(BTN_ID);
          if (host) {
            /* 按钮已在 DOM：若工具栏在而按钮被挤到别处（React 重渲染），归位 */
            if (found && host.parentElement !== found.toolbar) {
              found.toolbar.insertBefore(host, found.toolbar.firstElementChild);
            }
            return true;
          }
          if (!found) { return false; }
          var b = found.addBtn.cloneNode(false);
          b.id = BTN_ID;
          b.disabled = false;
          b.textContent = "检查更新";
          b.title = "比对全部已装插件与 npm registry 的版本（不含 dsh 本体）";
          b.addEventListener("click", openPanel);
          found.toolbar.insertBefore(b, found.toolbar.firstElementChild);
          return true;
        }
        mount();
        try {
          var mo = new MutationObserver(function () { mount(); });
          mo.observe(document.documentElement, { childList: true, subtree: true });
        } catch (e) {}
        setInterval(mount, 2000);
      }

      mountButton(function () { paint(); if (!rows.length && !checking) { checkNow(); } });
    }

    /* ======================================================================
     * 模块 4：动画修复（把 prefers-reduced-motion 强制成 no-preference）
     *
     * 背景：Windows「动画效果」关闭时 Chromium 对外报告 prefers-reduced-motion:
     * reduce，dsh 前端 17 个包共 40 处 @media (prefers-reduced-motion: reduce)
     * 规则把动画全关（圈圈不转、流光消失）。dsh-web-shell 用 CDP
     * Emulation.setEmulatedMedia 修复，但桌面端默认没有调试端口，CDP 进不去。
     *
     * 页面内等价修法（无需调试端口，web/桌面通用）：
     *  1) CSSOM 清除 —— 实测 dsh 的 CSS 全部经 <style> 标签注入（0 处
     *     adoptedStyleSheets），同源样式表能从 document.styleSheets 遍历
     *     cssRules；把 reduce 的 media 块整条删除后，基础动画声明（都在
     *     非 media 规则里）立即生效 —— 效果与 CDP 覆盖等价。
     *  2) matchMedia 包装 —— chat 包有 3 处 JS 门控（滚动平滑/跳转）读
     *     matchMedia；包一层按 no-preference 应答，顺带覆盖未来新增门控。
     *  CSS 分包是懒加载的，新 <style> 注入由 MutationObserver + 轮询兜底重扫；
     *  换肤等对既有 style 节点的重写也靠轮询兜回来。
     * ==================================================================== */
    function installAnimationFix() {
      if (window.__DSHUIW_ANIM__) { return; }
      window.__DSHUIW_ANIM__ = true;
      var REDUCE_RE = /prefers-reduced-motion\s*:\s*reduce/i;
      var purged = 0;

      /* 递归删 reduce media 块；owner 是持有 deleteRule 的一层（sheet 或外层规则） */
      function purge(ruleList, owner) {
        for (var i = ruleList.length - 1; i >= 0; i--) {
          var r = null;
          try { r = ruleList[i]; } catch (e) { continue; }
          if (!r) { continue; }
          if (r.media && REDUCE_RE.test(r.media.mediaText || "")) {
            try { owner.deleteRule(i); purged++; } catch (e) {}
            continue;
          }
          try { if (r.cssRules && r.cssRules.length) { purge(r.cssRules, r); } } catch (e) {}
        }
      }
      function scanAll() {
        var sheets = [];
        try { sheets = Array.prototype.slice.call(document.styleSheets); } catch (e) {}
        try { if (document.adoptedStyleSheets) { sheets = sheets.concat(Array.prototype.slice.call(document.adoptedStyleSheets)); } } catch (e) {}
        for (var i = 0; i < sheets.length; i++) {
          try {
            var sh = sheets[i];
            if (sh && sh.cssRules && sh.cssRules.length) { purge(sh.cssRules, sh); }
          } catch (e) {}   // 跨域 <link> 读 cssRules 会抛，静默跳过
        }
        return purged;
      }

      var first = scanAll();
      try { console.info("[dsh-ui-tweaks:" + BUILD + "] 动画修复：已清除 " + first + " 条 prefers-reduced-motion: reduce 规则"); } catch (e) {}

      /* 懒加载分包/换肤重写样式 → 防抖重扫；2s 轮询兜底（纯内存枚举，开销可忽略） */
      var timer = 0;
      function schedule() {
        if (timer) { return; }
        timer = setTimeout(function () { timer = 0; scanAll(); }, 200);
      }
      try {
        var mo = new MutationObserver(schedule);
        mo.observe(document.head, { childList: true, subtree: true });
      } catch (e) {}
      setInterval(scanAll, 2000);

      /* matchMedia 包装：一律按 no-preference 应答（覆盖 JS 门控）。
         注意要在应用渲染前生效 —— 本插件 apply 在合成期执行，早于挂载。 */
      try {
        var nativeMM = window.matchMedia ? window.matchMedia.bind(window) : null;
        if (nativeMM) {
          window.matchMedia = function (q) {
            var mql = nativeMM(q);
            try {
              var qs = String(q || "");
              if (/prefers-reduced-motion/i.test(qs)) {
                var fake = !/:\s*reduce/i.test(qs);   // reduce→false；no-preference/裸→true
                Object.defineProperty(mql, "matches", { value: fake, configurable: true });
              }
            } catch (e) {}
            return mql;
          };
        }
      } catch (e) {}
    }

    function apply(ctx) {
      try { window.__DSHUIW_BUILD__ = BUILD; } catch (e) {}
      guard("tablefix", installTableWidthFix);
      guard("scrollbar", installLeftScrollbar);
      guard("updates", function () { installPluginUpdates(ctx); });
      guard("anim", installAnimationFix);
    }

    module.exports = { name: "ui-tweaks", apply: apply, inject: ["remote", "remote.pluginManager", "remote.pluginInventory"] };
    return module.exports;
  }
});
