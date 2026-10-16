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

    const BUILD = "0.1.7";

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
     * 排队）；安装 spec 用面板解析出的**精确版本**（`name@版本`，不是 @latest），
     * 装完仍回读实际版本兜底（registry 与 pnpm 解析可能不一致），版本没变才是
     * 「暂缓更新」。
     *
     * minimumReleaseAge（DSH 自带 pnpm 11 注入，本机策略 1440 分钟）——两条独立路径，别混：
     *   ① 门禁：pnpm 拿磁盘上的 lockfile 做发布时长校验，命中就报
     *      ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION（exit 1）。实测（自带 pnpm 11.7.0）：
     *      无事可做时开头就整体失败、磁盘零改动；但安装若有活要干，改动照常落地、
     *      门禁在结尾才报错 —— 所以"先试一下看报什么错"会把 profile 留在「装上了但
     *      命令报错」的混乱态，必须靠装前硬闸拦住（见 startOne 里的 guardMaturity）。
     *   ② 解析/豁免：显式写 `name@版本` 时 pnpm 会**自动**把该版本写进
     *      minimumReleaseAgeExclude 并照常安装（实测）—— 精确版本 spec 反而是"绕过"
     *      的途径，所以冷却期不能只靠显示层拦截点击。
     *   豁免表本身：**同一个包名出现多条时只有文件中靠前的那条生效**（实测
     *   [0.69.0, 0.61.0] 通过、[0.61.0, 0.69.0] 失败，只差顺序）——陈旧条会静默遮蔽新条。
     *   这张表由 host 半边自动归并成「每包一条」（POST /api/ui-tweaks/normalize-excludes），
     *   强制更新则把目标版本写到块首（POST /api/ui-tweaks/force-exempt）；client 只负责
     *   在安装成功后 / 面板重新检查时尽力而为地触发一次归并。
     *   窗口内的版本在面板上标成「冷静期中」(cooling)：发布时间与门禁 cutoff 都
     *   能从 pnpm 报错文本里读出来，成熟时刻 = 发布时间 + (门禁运行时刻 − cutoff)；
     *   预判则拉全量 packument 的 time[版本] 自己算（见下面的 cooling 两段）。
     *   窗口内的版本在面板上标成「冷静期中」(cooling)：发布时间与门禁 cutoff 都
     *   能从 pnpm 报错文本里读出来，成熟时刻 = 发布时间 + (门禁运行时刻 − cutoff)；
     *   预判则拉全量 packument 的 time[版本] 自己算（见下面的 cooling 两段）。
     * ==================================================================== */
    function installPluginUpdates(ctx) {
      if (window.__DSHUIW_UPDATES__) { return; }
      window.__DSHUIW_UPDATES__ = true;
      var BTN_ID = "dshuiw-updates-btn-host";
      var RBTN_ID = "dshuiw-restart-btn-host";
      var PANEL_ID = "dshuiw-updates-panel-host";
      /* 用户是否主动收起了面板。paint() 只负责重画，**不负责把面板弹出来** ——
         否则后台一有动静（装完一个包、冷静期到点自动重查、超时兜底）就会把用户
         刚收起来的面板又弹回来。显示只由「打开」路径决定，隐藏只由「收起」路径决定。 */
      var panelClosed = false;
      /* 弹窗里的控件都是自绘 span（渲染结构与 CSS 都不动），键盘得自己接：
         可点的补 role=button/tabindex=0（KBD），Enter/Space 派发一次 click，
         走同一套点击委托，行为与鼠标完全一致。 */
      var KBD = ' role="button" tabindex="0"';
      /* 焦点环用官方自己的令牌（app 里有 237 条 :focus-visible，主题变量就是
         --dsw-focus-ring-*），与原生控件的焦点样式同色同宽，不自造灰色。
         三处使用点：两个 shadow 样式 + 页面级那两枚按钮。 */
      var FOCUS_RING = "outline:var(--dsw-focus-ring-width,2px) solid " +
        "var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,rgba(120,170,255,.9)));outline-offset:2px";

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

      /* ---- 报错文案 / 冷静期：纯函数区 ---------------------------------------
       * 这一段不读任何闭包状态（策略窗口、当前时刻、错误码表都作为参数传入），
       * 因此可以单独喂样例跑断言。
       * -------------------------------------------------------------------- */
      var MAX_POLICY_MS = 30 * 24 * 60 * 60 * 1000;       /* 反推窗口的合理上限（30 天） */

      /* pnpm 输出带 ANSI 转义（CSI 色码 / OSC 超链接）与不可打印控制字符，直接渲染
         就是用户第一屏看到的「鈺?」「鉁?」这类残渣；这里统一剥掉（保留 \n \t），
         并把 CRLF 归一成 \n（pnpm 日志是 CRLF）。 */
      function stripAnsi(s) {
        return String(s == null ? "" : s)
          .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, "")     /* OSC */
          .replace(/\u001b\[[0-9;?]*[ -\/]*[@-~]/g, "")                     /* CSI */
          .replace(/\u001b[@-Z\\-_]/g, "")                                  /* 其它两字节转义 */
          .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")   /* 控制字符 */
          .replace(/\r\n?/g, "\n");
      }

      function isoToMs(s) {
        var t = Date.parse(String(s == null ? "" : s));
        return isFinite(t) ? t : NaN;
      }

      /* registry 全量 packument 的 time 字段 → {版本: 发布时间ms}（created / modified
         是元数据不是版本）。/<pkg>/latest 与 abbreviated packument
         （Accept: application/vnd.npm.install-v1+json）都没有 time 字段，别用它们。 */
      function packumentTimes(doc) {
        var out = {};
        if (!doc || !doc.time || typeof doc.time !== "object") { return out; }
        for (var k in doc.time) {
          if (!Object.prototype.hasOwnProperty.call(doc.time, k)) { continue; }
          if (k === "created" || k === "modified") { continue; }
          var t = isoToMs(doc.time[k]);
          if (isFinite(t)) { out[k] = t; }
        }
        return out;
      }

      /* 门禁报错的解析（真实样例）：
           dsh-context@0.69.0 was published at 2026-10-11T18:46:04.000Z,
           within the minimumReleaseAge cutoff (2026-10-11T07:56:04.065Z)
         cutoff = 门禁运行时刻 − 窗口 ⇒ 窗口 = 现在 − cutoff，
         成熟时刻 = 发布时间 + 窗口。
         真实路径是「安装失败回调里立刻解析刚回来的报错」，现在 ≈ 门禁运行时刻，误差
         只有秒级；对陈旧报错文本反推会偏大，故窗口只接受 (0, 30 天]，越界退回
         defaultWindowMs（会话已从真实报错里学到的值，默认 1440 分钟）。 */
      function parseCoolingFailure(text, nowMs, defaultWindowMs) {
        var s = String(text == null ? "" : text);
        if (!/ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION|minimumReleaseAge|supply-chain polic/i.test(s)) {
          return null;
        }
        var out = {
          violation: true, packageName: "", version: "",
          publishedMs: NaN, cutoffMs: NaN, windowMs: NaN, matureAtMs: NaN
        };
        var mPub = /published at\s+([0-9T:.\-Z]+)/.exec(s);
        var mCut = /\bcutoff\b[^0-9]{0,8}([0-9T:.\-Z]+)/.exec(s);
        var mName = /(@?[^\s@\/]+(?:\/[^\s@\/]+)?)@([0-9][0-9A-Za-z.\-+]*)/.exec(s);
        if (mName) { out.packageName = mName[1]; out.version = mName[2]; }
        if (mPub) { out.publishedMs = isoToMs(mPub[1]); }
        if (mCut) { out.cutoffMs = isoToMs(mCut[1]); }
        var win = (isFinite(nowMs) && isFinite(out.cutoffMs)) ? (nowMs - out.cutoffMs) : NaN;
        if (!isFinite(win) || win <= 0 || win > MAX_POLICY_MS) {
          win = (isFinite(defaultWindowMs) && defaultWindowMs > 0) ? defaultWindowMs : NaN;
        }
        out.windowMs = win;
        if (isFinite(out.publishedMs) && isFinite(win)) { out.matureAtMs = out.publishedMs + win; }
        return out;
      }

      /* 从一次安装结果里认出「成熟期违规」：文本取自 error.message / diagnostic /
         code / packageResult.output（同一份 pnpm 输出的不同片段，合起来看）。 */
      function coolingFromResult(st, nowMs, defaultWindowMs, codeText) {
        if (!st || typeof st !== "object") { return null; }
        var pr = st.packageResult;
        var text = stripAnsi([
          st.error && st.error.message,
          st.error && st.error.diagnostic,
          st.error && st.error.code,
          pr && pr.output
        ].filter(function (x) { return !!x; }).join("\n"));
        var info = parseCoolingFailure(text, nowMs, defaultWindowMs);
        if (!info) { return null; }
        return {
          violation: true, version: info.version, packageName: info.packageName,
          publishedAt: info.publishedMs, matureAt: info.matureAtMs,
          windowMs: info.windowMs,
          detail: failureText(st, codeText)
        };
      }

      /* 失败原因必须落到面板上：旧实现只回一句「安装失败」，把 pnpm 的真实报错
         （如 ERR_PNPM_UNEXPECTED_STORE）连同 logPath 一起丢掉，用户只看到「超时」。
         diagnostic 与 packageResult.output 常是同一份 pnpm 输出的两段（dsh 摘的尾部
         vs 原始输出），两段都贴会让同一段报错在气泡里出现两遍：一段被另一段包含时
         只留更完整的那份；渲染前先剥掉转义与控制字符。 */
      function failureText(st, codeText) {
        var tbl = codeText || {};
        var parts = [];
        var code = st && st.error && st.error.code;
        parts.push("安装失败" + (code ? "：" + (tbl[code] || code) : ""));
        var diag = stripAnsi(st && st.error && st.error.diagnostic).replace(/^\s+|\s+$/g, "");
        var pr = st && st.packageResult;
        var out = stripAnsi(pr && pr.output).replace(/^\s+|\s+$/g, "");
        if (diag && out && (diag.indexOf(out) >= 0 || out.indexOf(diag) >= 0)) {
          if (out.length > diag.length) { diag = ""; } else { out = ""; }
        }
        if (diag) { parts.push(diag); }
        if (pr) {
          if (pr.kind) { parts.push("分类：" + pr.kind); }
          if (pr.exitCode) { parts.push("pnpm 退出码 " + pr.exitCode); }
          if (out) { parts.push("输出：" + out.slice(-800)); }
          if (pr.logPath) { parts.push("日志：" + pr.logPath); }
        }
        var pend = st && st.pendingBuilds;
        if (pend && pend.length) { parts.push("待授权的构建脚本：" + pend.join("、") + "（需在官方插件页授权后重试）"); }
        if (st && st.failedAt) { parts.push("失败环节：" + st.failedAt); }
        return parts.join(" ｜ ");
      }

      function pad2(n) { return (n < 10 ? "0" : "") + n; }
      /* 绝对时间用本地时间（MM-DD HH:mm） */
      function fmtLocal(ms) {
        var d = new Date(ms);
        return pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
      }
      /* 相对剩余时间（中文口吻）：11 小时 1 分 / 49 分钟 */
      function fmtLeftCn(ms) {
        var s = Math.max(0, Math.round(ms / 1000));
        var h = Math.floor(s / 3600);
        var m = Math.floor((s - h * 3600) / 60);
        if (h > 0) { return h + " 小时" + (m > 0 ? " " + m + " 分" : ""); }
        return m + " 分钟";
      }
      function fmtWindow(ms) {
        if (!isFinite(ms) || ms <= 0) { return ""; }
        var mins = Math.round(ms / 60000);
        if (mins < 60) { return mins + " 分钟"; }
        var hrs = mins / 60;
        return (hrs === Math.floor(hrs) ? String(hrs) : hrs.toFixed(1)) + " 小时";
      }
      /* cooling 行副标题：**一句话**（结论 + 到期时间 + 「点标签看详情」）。
         完整解释走 coolingReasonText（点标签展开才渲染），默认不占屏。
         换行由 .why 的 white-space:pre-wrap 呈现。 */
      function coolingWhyText(info) {
        var i = info || {};
        var ver = i.version ? String(i.version) : "该版本";
        var mature = i.matureAt;
        var left = isFinite(mature) ? (mature - (isFinite(i.nowMs) ? i.nowMs : 0)) : NaN;
        if (isFinite(left) && left <= 0) { return ver + " 的等待期已结束，点「重新检查」即可更新"; }
        if (isFinite(left)) { return ver + " 还需等待 " + fmtLeftCn(left) + "才能更新（" + fmtLocal(mature) + " 到期，点标签看详情）"; }
        return ver + " 还在保护期内，结束时间未确定（点标签看详情）";
      }
      /* cooling 的详情（点标签才出现）：为什么有这段等待 → 冷却期内硬装的后果 →
         到点自动恢复，末尾附原始诊断（预检给 registry 记录，反应式给 pnpm 报错）。 */
      function coolingReasonText(detail, windowMs) {
        var win = fmtWindow(windowMs);
        var out = "为什么会有这段等待：新版本发布后，dsh 会让它先放满" + (win ? " " + win : "一段保护期（默认 24 小时）") +
          "才允许安装，防止刚发布就被投毒的版本被自动装进来（这是 dsh 自带 pnpm 的策略，不是本插件加的）。";
        out += "\n冷却期内装会被 pnpm 拦下，而且会连带拒绝这个 profile 里的其它安装" +
          "（要清理 pnpm-workspace.yaml 的豁免表才能恢复），所以不提供直接安装。";
        out += "\n到点这一行会自动变回可更新，不用记时间。";
        if (detail) { out += "\n\n技术细节：" + String(detail); }
        return out;
      }
      /* ---- 纯函数区结束 ---- */

      /* ---- 供应链冷静期（cooling）：预判数据源与护栏 --------------------------
       * 预判 = 拉全量 packument 读该版本的发布时间（/<pkg>/latest 和 abbreviated
       * packument 都没有 time），发布时间 + 策略窗口 > 现在 → 该行标 cooling。
       * 会话级缓存：一个包只拉一次、缓存 10 分钟，失败（含超时）也缓存 —— 否则每次
       * 重绘都会重拉，就是重试风暴。超过 8 秒用 AbortController 掐断、体积异常大直接
       * 放弃：这两种情况都只是「不做预判」，该行保持「有新版本」，不报错、不重试。
       * 请求串行（同 registry 比对一样，别对 registry 打并发）。
       * 策略窗口优先用真实报错反推出来的值（见 coolingFromResult），默认 1440 分钟。
       * -------------------------------------------------------------------- */
      var DEFAULT_POLICY_MS = 1440 * 60000;       /* pnpm minimumReleaseAge 默认 1440 分钟 */
      var policyWindowMs = DEFAULT_POLICY_MS;
      var PACKUMENT_TTL_MS = 10 * 60000;
      var PACKUMENT_TIMEOUT_MS = 8000;
      var PACKUMENT_MAX_CHARS = 4 * 1024 * 1024;
      var packumentCache = {};                    /* name → {at, ok, time:{版本:ms}, err} */
      var packumentChain = Promise.resolve();     /* 串行闸门 */

      function fetchPackumentTimes(name, cb) {
        var hit = packumentCache[name];
        if (hit && Date.now() - hit.at < PACKUMENT_TTL_MS) { cb(hit); return; }
        var ctl = null, timer = null, done = false;
        function settle(res) {
          if (done) { return; }
          done = true;
          if (timer) { clearTimeout(timer); timer = null; }
          packumentCache[name] = res;
          try { cb(res); } catch (e) {}
        }
        function begin() {
          try { if (typeof AbortController === "function") { ctl = new AbortController(); } } catch (e1) {}
          if (ctl) { timer = setTimeout(function () { try { ctl.abort(); } catch (e2) {} }, PACKUMENT_TIMEOUT_MS); }
          var path = String(name).split("/").map(encodeURIComponent).join("/");
          var opts = { cache: "no-store", headers: { Accept: "application/json" } };
          if (ctl) { opts.signal = ctl.signal; }
          return fetch("https://registry.npmjs.org/" + path, opts)
            .then(function (r) {
              if (!r || !r.ok) { throw new Error("HTTP " + (r ? r.status : "?")); }
              return r.text();
            })
            .then(function (txt) {
              txt = String(txt == null ? "" : txt);
              if (txt.length > PACKUMENT_MAX_CHARS) { throw new Error("packument 体积异常大（" + txt.length + " 字符）"); }
              var doc = null;
              try { doc = JSON.parse(txt); } catch (e3) { throw new Error("packument 不是合法 JSON"); }
              settle({ at: Date.now(), ok: true, time: packumentTimes(doc) });
            })
            .catch(function (e) { settle({ at: Date.now(), ok: false, err: msgOf(e), time: {} }); });
        }
        packumentChain = packumentChain.then(begin, begin).catch(function () {});
      }

      /* 预判：只对「有新版本」的行做。窗口内 → cooling（标签不可点击安装）；
         窗口外 / 数据源不可用 → 保持 update。 */
      function applyCoolingGuess(name) {
        var row = findRow(name);
        if (!row || row.state !== "update" || !row.latest) { return; }
        var ver = row.latest;
        fetchPackumentTimes(name, function (res) {
          var r = findRow(name);
          /* 期间该行可能被安装 / 重查改过：只处理仍是「有新版本」且版本没变的行 */
          if (!r || r.state !== "update" || r.latest !== ver) { return; }
          if (!res || !res.ok || !res.time) { return; }
          var pub = res.time[ver];
          if (!isFinite(pub)) { return; }
          var mature = pub + policyWindowMs;
          if (!isFinite(mature) || Date.now() >= mature) { return; }
          setRow(name, {
            state: "cooling", publishedAt: pub, matureAt: mature, why: "",
            detail: "registry 记录 " + ver + " 发布于 " + new Date(pub).toISOString() +
              "；minimumReleaseAge 策略窗口 " + fmtWindow(policyWindowMs) + "。" +
              "pnpm 在解析之前校验 lockfile，窗口内的版本会让整个 profile 的安装整体中止" +
              "（ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION，exit 1）。"
          });
          scheduleCoolingRefresh(name, mature);
        });
      }

      /* 冷静期到期后自动变回可更新：到点重查那一行（变回「有新版本」或「已是最新」），
         用户不用记时间、也不用手动点「重新检查」。按包名去重，重复触发只留最后一个定时器。 */
      var coolingTimers = {};   // name → timerId
      function scheduleCoolingRefresh(name, matureAt) {
        try {
          if (!isFinite(matureAt)) { return; }
          if (coolingTimers[name]) { clearTimeout(coolingTimers[name]); delete coolingTimers[name]; }
          var delay = matureAt - Date.now() + 3000;   // 3s 缓冲，避开边界抖动
          if (delay < 0) { delay = 0; }
          if (delay > 2147483000) { return; }         // 超出 setTimeout 上限（约 24.8 天）就不排
          coolingTimers[name] = setTimeout(function () {
            delete coolingTimers[name];
            var r = findRow(name);
            if (!r || r.state !== "cooling") { return; }   // 期间已被安装 / 重查改过，不动它
            checkOne(name);
          }, delay);
        } catch (e) {}
      }

      /* ---- 强制更新（跳过冷静期）：预检 → 二次确认 → host 写生效豁免 → 走正常安装 ----
       * 真机实测（自带 pnpm 11.7.0）：精确版本 spec 会让 pnpm 自己补豁免并装上；
       * 门禁校验的是**整个 lockfile**，所以「别的包也没满 24 小时」时强制照样会被整体
       * 拒绝 —— 因此先预检、就地列出拦路者并拒绝（不写盘、不尝试安装）。 */
      var forceStage = {};    // name → "" | "checking" | "blocked" | "confirm" | "writing" | "error"
      var forceBlocked = {};  // name → [{name, version, publishedAt, matureAt}]
      var forceNote = {};     // name → 错误说明
      /* 一次性放行凭据：安装前的成熟期硬闸默认拦截未成熟版本，只有走完强制流程
         （预检 + 二次确认 + host 已写生效豁免）才会带上它。用完即删、终态也清。 */
      var forcedNames = {};   // name → true

      function hostPost(route, body) {
        try {
          return fetch("/api/ui-tweaks/" + route, {
            method: "POST", cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body || {}),
          }).then(function (r) {
            return r.json().then(function (j) { return j; }, function () { return { ok: false, code: "HTTP " + r.status }; });
          }).catch(function (e) { return { ok: false, code: String((e && e.message) || e) }; });
        } catch (e) {
          return Promise.resolve({ ok: false, code: String((e && e.message) || e) });
        }
      }
      function hostGet(route) {
        try {
          return fetch("/api/ui-tweaks/" + route, { cache: "no-store" })
            .then(function (r) {
              return r.json().then(function (j) { return j; }, function () { return { ok: false, code: "HTTP " + r.status }; });
            })
            .catch(function (e) { return { ok: false, code: String((e && e.message) || e) }; });
        } catch (e) {
          return Promise.resolve({ ok: false, code: String((e && e.message) || e) });
        }
      }

      /* ---- 立即重启：独立弹窗 ---------------------------------------------------
         重启不是「更新检查」的一个阶段，它的后果（中断会话）值得单独一块地方说清楚，
         所以给它自己一层 Shadow DOM 弹窗，挂在按钮下方。
         流程参考 plugin-manager 的三段式（只读方案 → 确认 → 执行），并加一条它没有的：
         **先问会话有没有在跑** —— 没有在跑的会话就直接执行，不打扰人；有才弹中断提示。
         宿主形态决定重启怎么做（shell / relaunch / manual），文案按形态给。 */
      var RST_PANEL_ID = 'dshuiw-restart-panel-host';
      var scrimShown = false; // 蒙皮是否正盖在页面上（键盘滚动锁的开关）
      var rstStage = '';     // '' | checking | auto | confirm | busy | done | error
      var rstMode = '';      // relaunch | shell | manual
      var rstNote = '';
      var rstActive = null;  // 正在运行的会话数；null = 问不到
      var rstNames = [];     // 正在运行的会话标题（最多列几条）
      var rstBtn = null;     // 顶栏那枚按钮，用来给弹窗定位
      var RST_KILL_WAIT_MS = 20000;   // 蒙皮兜底：这么久还没断线就把蒙皮撤掉

      /* 按宿主形态说清「点下去会发生什么」。桌面端尤其要说透：dsh 先退出，真正把它
         拉起来的是客户端自己的错误对话框 —— 用户得知道去那个对话框里点「重启」。 */
      function restartHowText(mode) {
        if (mode === 'shell') {
          return '点下去分两步：\n' +
            '① dsh 先退出（当前页面会断开）；\n' +
            '② 客户端随即弹出官方的「应用无法启动或已意外停止」对话框 —— 在对话框里点「重启」，dsh 才会被重新拉起。';
        }
        if (mode === 'manual') {
          return '这台运行方式下插件无法自动重启：请手动退出 dsh 再重新打开（桌面端：退出 DeepSeek Harness 后重新打开）。';
        }
        return '点下去 dsh 服务会重新拉起，正在运行的任务会中断；服务恢复后刷新页面即可。';
      }
      function restartShellExtra() {
        return '那个对话框同时会写一份崩溃报告；不想走对话框，也可以手动重启：退出 DeepSeek Harness 后重新打开。';
      }
      function restartDoneText(mode) {
        if (mode === 'shell') {
          return 'dsh 正在退出。稍后客户端会弹出「应用无法启动或已意外停止」对话框 —— 在对话框里点「重启」即可；也可以手动重启：退出 DeepSeek Harness 后重新打开。';
        }
        if (mode === 'manual') { return '这台运行方式下插件无法自动重启：请手动退出 dsh 后重新打开。'; }
        return '已请求重启；dsh 服务恢复后刷新页面即可。';
      }

      /* 正在运行的会话数：问客户端 sessions 服务（GUI 自己的运行态来源）。刷新一次
         列表再读快照，900ms 内没回来就用现有快照；服务不在、形状不认识 → null
         （问不到），此时按保守处理：照旧弹确认。 */
      function sessionService() {
        var s = null;
        try { if (ctx && typeof ctx.get === 'function') { s = ctx.get('sessions'); } } catch (e) {}
        if (!s) { s = pickService(null, 'sessions'); }
        return s;
      }
      function runningSessions(cb) {
        var settled = false;
        var timer = setTimeout(function () { read(); }, 900);
        function done(n, names) {
          if (settled) { return; }
          settled = true; clearTimeout(timer);
          cb(n, names);
        }
        function read() {
          var svc = sessionService();
          var store = svc && svc.list;
          if (!store || typeof store.getSnapshot !== 'function') { done(null, []); return; }
          try {
            var snap = store.getSnapshot() || {};
            var byId = snap.byId || {};
            var n = 0, names = [];
            for (var k in byId) {
              if (byId[k] && byId[k].running) {
                n++;
                names.push(String(byId[k].displayTitle || byId[k].title || k));
              }
            }
            done(n, names.slice(0, 5));
          } catch (e) { done(null, []); }
        }
        var svc2 = sessionService();
        if (svc2 && typeof svc2.refresh === 'function') {
          try { Promise.resolve(svc2.refresh()).then(read, read); return; } catch (e) {}
        }
        read();
      }

      /* 弹窗本体：自己的 Shadow DOM；位置按按钮的屏幕矩形算（fixed，不受页面布局裁剪） */
      function rstWrap() {
        var host = document.getElementById(RST_PANEL_ID);
        if (host && host.shadowRoot) { return host.shadowRoot.querySelector('.rwrap'); }
        if (host) { host.remove(); }
        host = document.createElement('div');
        host.id = RST_PANEL_ID;
        document.body.appendChild(host);
        var sr = host.attachShadow({ mode: 'open' });
        sr.innerHTML = '<style>' +
          '.rwrap{position:fixed;z-index:2147483001;width:330px;border-radius:12px;padding:12px;overflow:auto;' +
          'border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.32));' +
          'background:var(--dsw-alias-bg-base,#1b1d23);color:var(--dsw-alias-label-primary,#e8e9ec);' +
          'box-shadow:0 10px 30px rgba(0,0,0,.34);font:13px/1.55 system-ui,-apple-system,"Microsoft YaHei UI",sans-serif}' +
          '.rwrap[hidden]{display:none}' +
          '[role="button"]:focus-visible{' + FOCUS_RING + '}' +
          '.rt{font-weight:600;margin-bottom:6px}' +
          '.rb{font-size:12px;line-height:1.5;opacity:.85;white-space:pre-wrap;word-break:break-word}' +
          '.rl{margin:6px 0 0 10px;font-size:12px;opacity:.9}' +
          '.rr{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}' +
          '.rbtn{cursor:pointer;font-size:12px;padding:4px 12px;border-radius:999px;' +
          'border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4))}' +
          '.rbtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14))}' +
          '.rgo{background:rgba(255,80,80,.18);border-color:rgba(255,80,80,.55);color:#ff8a8a;font-weight:600}' +
          '.rgo:hover{background:rgba(255,80,80,.3)}' +
          /* 蒙皮：确认重启后整页进入不可用状态，用它挡住底下所有可点元素（z-index 比弹窗低 1，
             弹窗仍在最上层可交互）。轮子/触摸也拦掉，免得还能滚动下面的页面。 */
          '.rscrim{position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483000;cursor:progress;' +
          'background:rgba(8,10,14,.5);backdrop-filter:blur(1.5px);-webkit-backdrop-filter:blur(1.5px)}' +
          '.rscrim[hidden]{display:none}' +
          '</style><div class="rscrim" hidden></div><div class="rwrap" role="dialog" aria-modal="true" aria-label="重启 dsh" hidden></div>';
        var scrim = sr.querySelector('.rscrim');
        try {
          scrim.addEventListener('wheel', function (e) { e.preventDefault(); }, { passive: false });
          scrim.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
        } catch (e) {}
        var wrap = sr.querySelector('.rwrap');
        wrap.addEventListener('click', function (e) {
          var t = e.target;
          if (!t || !t.classList) { return; }
          if (t.classList.contains('rgo')) { restartGo(); return; }
          if (t.classList.contains('rretry')) { restartOpen(); return; }
          if (t.classList.contains('rcancel') || t.classList.contains('rdismiss')) { restartClose(true); return; }
        });
        /* 点外部/Esc 收起；点自己那枚按钮不算外部（交给按钮做开关） */
        document.addEventListener('pointerdown', function (e) {
          var cur = host.shadowRoot.querySelector('.rwrap');
          if (!cur || cur.hidden || rstStage === 'busy') { return; }
          if (host.contains(e.target)) { return; }
          if (rstBtn && (rstBtn === e.target || rstBtn.contains(e.target))) { return; }
          restartClose();
        }, true);
        document.addEventListener('keydown', function (e) {
          if (e.key !== 'Escape' || rstStage === 'busy') { return; }
          var cur = host.shadowRoot.querySelector('.rwrap');
          if (cur && !cur.hidden) { restartClose(true); }
        });
        /* 蒙皮期间页面已 inert，但键盘仍可能滚动后面的文档（PageDown/空格/方向键）：
           在捕获段拦掉纯滚动键。焦点在弹窗里时 e.target 会被重定向成宿主，那时不拦 ——
           弹窗该能自己滚，按钮也该能用空格触发。 */
        document.addEventListener('keydown', function (e) {
          if (!scrimShown) { return; }
          var hostEl = document.getElementById(RST_PANEL_ID);
          if (hostEl && (e.target === hostEl || hostEl.contains(e.target))) { return; }
          var k = e.key;
          if (k === 'PageDown' || k === 'PageUp' || k === 'ArrowDown' || k === 'ArrowUp' ||
              k === 'Home' || k === 'End' || k === ' ' || k === 'Spacebar') {
            e.preventDefault();
          }
        }, true);
        wireKeyActivation(wrap);
        return wrap;
      }

      /* ---- 蒙皮：确认重启后把整页蒙住（客户端此时已不可用，界面元素不该还能点）---- */
      /* 蒙皮只挡指针。键盘仍能 Tab 到后面的元素并回车激活，所以同时把 body 的其它
         子树整块 inert 掉（Chromium 102+ 支持；弹窗自己的宿主除外）。关掉时如实还原。 */
      function setPageInert(on) {
        try {
          var kids = document.body.children;
          for (var i = 0; i < kids.length; i++) {
            var el = kids[i];
            if (!el || el.id === RST_PANEL_ID) { continue; }
            if (on) { el.setAttribute("inert", ""); } else { el.removeAttribute("inert"); }
          }
        } catch (e) {}
      }
      function showScrim(on) {
        try {
          rstWrap();   // 确保阴影根在（隐藏的弹窗也没关系）
          var host = document.getElementById(RST_PANEL_ID);
          var s = host && host.shadowRoot ? host.shadowRoot.querySelector('.rscrim') : null;
          if (s) { s.hidden = !on; }
          scrimShown = !!on;
          setPageInert(on);
        } catch (e) {}
      }
      var rstKillTimer = 0;
      function clearKillTimer() {
        if (rstKillTimer) { clearTimeout(rstKillTimer); rstKillTimer = 0; }
      }
      /* 兜底：等了 RST_KILL_WAIT_MS 页面还活着，说明重启没退成（或已重启完但连接没断），
         这时必须把蒙皮撤掉并给出可点的出口，别把人永远蒙在里面。 */
      function armKillTimer() {
        clearKillTimer();
        rstKillTimer = setTimeout(function () {
          rstKillTimer = 0;
          if (rstStage !== 'busy') { return; }
          showScrim(false);
          rstStage = 'error';
          rstNote = '等了 ' + Math.round(RST_KILL_WAIT_MS / 1000) + ' 秒 dsh 还没退出：重启可能已经完成但页面没断，先刷新页面看看；也可以手动退出 DeepSeek Harness 后重新打开。';
          rstRender();
        }, RST_KILL_WAIT_MS);
      }

      function rstRender() {
        var wrap = rstWrap();
        function btn(cls, label) { return '<span class="rbtn ' + cls + '"' + KBD + '>' + label + '</span>'; }
        var title = '重启 dsh';
        var body = '';
        var actions = '';
        var list = '';
        if (rstStage === 'checking') {
          body = '正在读取重启方式、并检查有没有会话在运行…';
        } else if (rstStage === 'busy') {
          body = '正在重启…\n' + restartDoneText(rstMode);
        } else if (rstStage === 'error') {
          title = '没能重启';
          body = rstNote;
          actions = btn('rretry', '重试') + btn('rdismiss', '知道了');
        } else if (rstStage === 'confirm') {
          /* 不论有没有会话在跑，都先弹出来等用户点确认 —— 重启是进程级动作，别自作主张 */
          title = '确认重启？';
          if (rstActive === null) {
            body = '问不到会话运行状态，按保守处理：重启会中断正在运行的任务。\n';
          } else if (rstActive === 0) {
            body = '没有会话在运行，现在重启不会打断任何任务。\n';
          } else {
            body = '有 ' + rstActive + ' 个会话正在运行，重启会中断它们：\n';
            list = rstNames.map(function (n) { return '<div class="rl">· ' + esc(n) + '</div>'; }).join('');
          }
          body += restartHowText(rstMode);
          /* manual 模式下没有可点的「重启」，给个按钮只是骗人 */
          actions = rstMode === 'manual' ? btn('rdismiss', '知道了') : (btn('rgo', '重启 dsh') + btn('rcancel', '取消'));
        } else {
          /* done 只在 manual 退化时出现（宿主没退出，页面还活着）：给一个点得到的收尾按钮。
             shell / relaunch 成功后停在 busy，不做这个状态 —— 那时页面已经要没了。 */
          body = restartDoneText(rstMode) + (rstNote ? '\n' + rstNote : '');
          actions = btn('rdismiss', '知道了');
        }
        if (rstMode === 'shell' && rstStage !== 'checking' && rstStage !== 'error') { body += '\n' + restartShellExtra(); }
        if (updatedCount && rstStage !== 'checking') { body += '\n已更新 ' + updatedCount + ' 个插件，重启后才会生效。'; }
        var html = '<div class="rt">' + esc(title) + '</div><div class="rb">' + esc(body) + '</div>' + list +
          (actions ? '<div class="rr">' + actions + '</div>' : '');
        if (wrap.innerHTML !== html) { wrap.innerHTML = html; }
        wrap.hidden = false;
        placeNear(rstBtn, wrap, RST_WIDTH, 180);
        /* 键盘：确认/失败/收尾态把焦点交给主按钮；弹窗里已经有焦点就不抢 */
        if (rstStage === 'confirm' || rstStage === 'error' || rstStage === 'done') {
          try {
            var hostEl = document.getElementById(RST_PANEL_ID);
            var inside = hostEl && hostEl.shadowRoot ? hostEl.shadowRoot.activeElement : null;
            var primary = wrap.querySelector('.rgo, .rretry, .rdismiss, .rcancel');
            if (primary && !inside) { primary.focus(); }
          } catch (e) {}
        }
      }

      function restartClose(refocus) {
        showScrim(false);
        clearKillTimer();
        var wrap = rstWrap();
        wrap.hidden = true;
        rstStage = ''; rstNote = ''; rstActive = null; rstNames = [];
        /* 键盘：收起后把焦点还给「立即重启」。点外部收起的传 false */
        if (refocus) { try { if (rstBtn && document.contains(rstBtn)) { rstBtn.focus(); } } catch (e) {} }
      }

      /* 打开：并行读「重启方案」与「在跑的会话」，两者都回来再决定 */
      function restartOpen() {
        showScrim(false);
        clearKillTimer();
        rstStage = 'checking'; rstNote = ''; rstActive = null; rstNames = [];
        rstRender();
        var plan = null, running;
        function decide() {
          if (plan === null || running === undefined) { return; }
          if (rstStage !== 'checking') { return; }   // 期间被关掉了：迟到的结果不再把弹窗拉起来
          if (!plan.ok) {
            rstStage = 'error';
            rstNote = '读不到重启方案：' + String(plan.code || '未知原因') + '（host 半区可能还没重启）';
            rstRender(); return;
          }
          rstMode = String(plan.mode || '');
          /* 不论 0 / N / 问不到，都落到同一个确认面板等用户点「重启 dsh」 */
          rstActive = running;
          rstStage = 'confirm';
          rstRender();
        }
        hostGet('restart').then(function (j) { plan = j || { ok: false, code: 'empty' }; decide(); });
        runningSessions(function (n, names) { running = n; rstNames = names || []; decide(); });
      }

      function restartGo() {
        /* 用户已确认：整页进入不可用状态，先蒙住再执行 —— 底下任何元素都不该还能点 */
        rstStage = 'busy'; rstNote = '';
        showScrim(true);
        armKillTimer();
        rstRender();
        hostPost('restart', {}).then(function (j) {
          if (!j || !j.ok) {
            /* 回包中断多半就是宿主已经退出（连接先断是正常的），但"多半"不等于一定：
               如实报成失败并给可点的出口（重试 / 刷新页面看看），别留一个死状态。 */
            rstStage = 'error';
            rstNote = (rstMode === 'shell' || rstMode === 'relaunch')
              ? '没收到重启回包 —— 连接中断通常意味着 dsh 确实在重启，刷新页面看看服务是否回来；没回来的话再点一次。'
              : '重启请求失败：' + String((j && j.code) || '未知原因');
            showScrim(false); clearKillTimer();   // 页面还活着，把出口还给用户
            rstRender(); return;
          }
          rstMode = String(j.mode || rstMode);
          /* shell / relaunch：宿主正在退出，这个弹窗马上随页面一起消失 ——
             停在「正在重启…」并说明下一步即可，**不给按钮**（给也点不到）。
             manual 是"方案本来能重拉、但助手没起来"的退化结果：宿主不会退出，
             这时才需要一个能点的「知道了」。 */
          if (rstMode === 'manual') {
            showScrim(false); clearKillTimer();   // 宿主不会退出，得让用户能继续操作
            rstStage = 'done'; rstRender(); return;
          }
          rstStage = 'busy'; rstRender();   // shell / relaunch：蒙皮留着，等页面随宿主一起消失
        });
      }

      /* 顶栏「立即重启」按钮：弹窗开着＝收起，否则打开 */
      function onRestartClick() {
        if (rstStage === 'busy') { return; }   // 已确认重启：蒙皮下不再响应
        var wrap = rstWrap();
        if (!wrap.hidden && rstStage !== 'checking' && rstStage !== 'busy') { restartClose(); return; }
        restartOpen();
      }

      function forceReset(name) { forceStage[name] = ""; forceBlocked[name] = null; forceNote[name] = ""; }
      function forceSet(name, stage, note) { forceStage[name] = stage; forceNote[name] = note || ""; emit(); }

      function forceCheck(name) {
        var row = findRow(name);
        if (!row || row.state !== "cooling" || !row.latest) { return; }
        forceSet(name, "checking");
        hostPost("precheck-exempt", { name: name, version: row.latest, windowMs: policyWindowMs }).then(function (r) {
          var cur = findRow(name);
          if (!cur || cur.state !== "cooling") { forceReset(name); return; }
          if (!r || !r.ok) { forceSet(name, "error", "预检没能完成：" + String((r && r.code) || "未知原因")); return; }
          var b = (r.blocked || []).filter(function (x) { return x && x.name && x.name !== name; });
          if (b.length) { forceBlocked[name] = b; forceSet(name, "blocked"); return; }
          forceSet(name, "confirm");
        });
      }

      function forceGo(name) {
        var row = findRow(name);
        if (!row || !row.latest) { return; }
        var ver = row.latest;
        forceSet(name, "writing");
        hostPost("force-exempt", { name: name, version: ver }).then(function (r) {
          if (!r || !r.ok) { forceSet(name, "error", "写入豁免表失败：" + String((r && r.code) || "未知原因")); return; }
          forceReset(name);
          forcedNames[name] = true;   // 硬闸放行凭据（一次性，终态清理）
          enqueue(name, { force: true });
        });
      }

      /* 详情里的强制区（渲染在详情块内、按钮右下对齐）：按阶段给出入口 / 预检中 /
         拦路者清单 / 二次确认 / 写入中 / 出错。按钮用橙色强调，避免"看不出来能点"。 */
      function forceArea(r) {
        var name = r.name;
        var stage = forceStage[name] || "";
        var ver = r.latest || r.version;
        function btn(cls, label) {
          return "<span class=\"fbtn " + cls + "\" data-n=\"" + esc(name) + "\"" + KBD + ">" + label + "</span>";
        }
        if (stage === "checking") { return "<div class=\"force\"><div class=\"fn\">正在预检…</div></div>"; }
        if (stage === "writing") { return "<div class=\"force\"><div class=\"fn\">正在写入豁免表…</div></div>"; }
        if (stage === "blocked") {
          var list = (forceBlocked[name] || []).map(function (b) {
            return "<div class=\"fi\">" + esc(b.name + "@" + b.version) + "（" + esc(fmtLocal(b.matureAt)) + " 之后才满 24 小时）</div>";
          }).join("");
          return "<div class=\"force\"><div class=\"fb\">先别急：现在强制更新也会被 pnpm 拦下</div>" +
            "<div class=\"fn\">lockfile 里下面这些包自己还没满 24 小时，门禁会整体拒绝本次安装（不只拦这一个）：</div>" + list +
            "<div class=\"fn\">等它们到期、或对其中一个也走强制更新，再回来试这个。</div>" +
            "<div class=\"fbrow\">" + btn("fcancel", "知道了") + "</div></div>";
        }
        if (stage === "confirm") {
          return "<div class=\"force\"><div class=\"fb\">确认强制更新到 " + esc(ver) + "？</div>" +
            "<div class=\"fn\">确认后会跳过 dsh 的 24 小时供应链保护：先把该版本写进豁免表，再直接安装。" +
            "该版本发布未满 24 小时，请确认来源可信。</div>" +
            "<div class=\"fbrow\">" + btn("fgo", "确认强制更新") + btn("fcancel", "取消") + "</div></div>";
        }
        if (stage === "error") {
          return "<div class=\"force\"><div class=\"fb\">没能强制更新</div>" +
            "<div class=\"fn\">" + esc(forceNote[name] || "") + "</div>" +
            "<div class=\"fbrow\">" + btn("fcheck", "重试") + btn("fcancel", "收起") + "</div></div>";
        }
        return "<div class=\"force\"><div class=\"fbrow\">" +
          btn("fcheck", "仍要强制更新到 " + esc(ver) + "（跳过 24 小时冷却期）") + "</div></div>";
      }

      /* 安装成功后 / 面板重新检查时，尽力而为地让 host 半边把 profile 的
         minimumReleaseAgeExclude 归并成「每包一条」：同一个包名出现多条时只有靠前的
         那条生效，陈旧条会静默遮蔽新条，让下一次安装继续撞门禁。
         fire-and-forget：不 await（不阻塞 UI）、失败不弹错、异常全吞
         （host 未重启时这个路由就是 404）。 */
      function normalizeExcludes() {
        try {
          fetch("/api/ui-tweaks/normalize-excludes", {
            method: "POST", cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: "{}"
          }).catch(function () {});
        } catch (e) {}
      }
      /* ---- 冷静期预判区结束 ---- */

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
          .then(function (d) {
            return d && d.version ? { version: String(d.version), requiresDsh: dshRequirementOf(d) } : null;
          });
      }

      /* 新版声明的 DSH 最低版本：dsh.engines.dsh → engines.dsh → peerDependencies
         （与 plugin-manager 同一套取法），都没有就是没声明。 */
      function dshRequirementOf(d) {
        try {
          var v = (d && d.dsh && d.dsh.engines && d.dsh.engines.dsh) ||
                  (d && d.engines && d.engines.dsh) ||
                  (d && d.peerDependencies && d.peerDependencies["@deepseek-ai/dsh"]);
          return typeof v === "string" && v.trim() ? v.trim() : "";
        } catch (e) { return ""; }
      }

      /* 兼容门禁（借鉴 plugin-manager）：新版要求 DSH ≥ x，而本机不够 → 这一行标
         「DSH 不符」、不可更新 —— 装上去也起不来。只认 `>=x.y.z` 这种能判定的写法；
         本机版本读不到 / 写法不认识 → 返回 null = 不拦（宁可漏拦，不误伤正常更新）。 */
      var hostDshVersion = "";   // host 半边回的运行中 DSH 版本，空 = 未知
      function meetsDsh(requiresDsh) {
        var req = String(requiresDsh || "").trim();
        if (!req || !hostDshVersion) { return null; }
        var m = /^>=\s*(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(req);
        if (!m) { return null; }
        var host = String(hostDshVersion).trim().replace(/^v/, "");
        if (!/^\d+\.\d+\.\d+/.test(host)) { return null; }
        return cmpSemver(host, m[1].replace(/^v/, "")) >= 0;
      }
      /* 版本更新的落点状态：够新才叫有更新；要求更高 DSH 的标 dsh */
      function newerState(latest, requiresDsh, current) {
        if (!latest || !(cmpSemver(latest, current) > 0)) { return "current"; }
        return meetsDsh(requiresDsh) === false ? "dsh" : "update";
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
              remote: d && d.ok && Array.isArray(d.remote) ? d.remote : [],
              dsh: d && d.ok && typeof d.dsh === "string" ? d.dsh : ""
            });
          })
          .catch(function () { cb({ local: [], remote: [] }); });
      }
      function isLocalSrc(src) { return /^(link:|file:)/.test(String(src || "")); }
      function isRemoteSrc(src) { return /^(git[+:@]|github:|git:|http)/.test(String(src || "")); }

      /* ---- 面板状态 ---- */
      var rows = [];              // {name, version, latest, state, why, publishedAt, matureAt, detail}
      /* state（与 TAG_TEXT 一一对应，多一个少一个都是 bug）：
         checking | current | update | dsh | local | remote | unknown | error | queuing | busy
         | unchanged | unconfirmed | fail | cooling
         dsh（DSH 不符）：新版声明了更高的 DSH 最低版本，本机不够 —— 装了也起不来，
         标签只给悬停说明，不提供任何点击动作。
         cooling（冷静期中）：还有比已装更新的版本，但它的发布时间没满 minimumReleaseAge
         窗口 —— matureAt = 成熟时刻，detail = 展开后的详情文本；该标签不可点击安装。 */
      var revealedCooling = {};   // name → true：该行详情已展开（点 cooling 标签切换）
      var queue = [];             // 待更新名单（串行队列）
      var busyName = "";          // 正在更新的那个
      var busyReq = "";
      var busyBefore = "";       // 本次安装前该行的版本（回读比对基准，不受中途重查影响）
      var busyLatest = "";       // 本次安装解析出的目标版本（取消后退回「有新版本」要用）
      var cancelling = false;
      var checking = false;
      var updatedCount = 0;       // 本次页面会话里成功更新的插件数（>0 时头部挂「重启生效」提示条）
      var isDesktop = /Electron/i.test(String(navigator.userAgent || ""));
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
        /* 重新检查 / 打开面板：顺手让 host 半边归并一次豁免表（fire-and-forget） */
        normalizeExcludes();
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
                  src: src, enabled: b.enabled !== false, why: ""
                };
              }).filter(function (x) { return x.name; })
              /* 官方 @deepseek-ai 插件由 dsh 本体更新流程负责，直接从检查列表里剔除 */
              .filter(function (x) { return !/^@deepseek-ai\//.test(x.name); });
              /* 与在飞的安装对齐（见 reconcileInstallStates）：重查不得抹掉「更新中/等待更新」 */
              reconcileInstallStates();
              checking = false;
              emit();
              // 先向 host 半区要非 registry 直装名单，命中的行直接标「本地链接」或「Git 直装」
              // 不进比对 —— 已发布到 npm 的本地/仓库源（如 @nimoxie/dsh-model-organizer、
              // dsh-ego-browser）靠它认出；host 未重启（无路由）时名单为空，退回
              // registry 404 签名判定。
              fetchLocalNames(function (srcs) {
                hostDshVersion = srcs.dsh || "";   // 兼容门禁的本机基准（空 = 未知，不拦）
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
                      var latest = v && v.version ? v.version : "";
                      row.latest = latest;
                      row.requiresDsh = (v && v.requiresDsh) || "";
                      row.state = newerState(latest, row.requiresDsh, row.version);
                      emit();
                      /* 有新版本、且本机 DSH 够用，才做冷静期预判（异步，不阻塞比对链） */
                      if (row.state === "update") { applyCoolingGuess(row.name); }
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

            /* ---- 更新执行：串行队列 ------------------------------------------------
       * installBundle 是「等到装完才返回」的调用：返回信封的 .value 就是终态对象
       * （application / stage / target / error / packageResult / pendingBuilds …），
       * 官方桌面端 UI 也是 await 它之后直接拿 .value 定案。
       * waitForInstall 只用于**响应丢失后的恢复**：请求不在活动中时返回 null，
       * 且「已完成的结果不保留」。把它当进度轮询器（旧实现）必然永远读到 null、
       * 一路空转到 240s 看门狗 —— 这就是「更新总是超时」的真因。
       * 正常路径只读 res.value；仅当信封本身失败（res.ok === false，结果未知）才用
       * waitForInstall 兜一次，仍为 null 就如实报「结果未知」。
       * ------------------------------------------------------------------ */
      function findRow(name) {
        for (var i = 0; i < rows.length; i++) { if (rows[i].name === name) { return rows[i]; } }
        return null;
      }
      function msgOf(e) { return String((e && e.message) || e); }

      /* 重新检查后把在飞状态盖回新行：否则「更新中/等待更新」会被抹成「有新版本」，
         点它会撞上 enqueue 的 busyName 保护而毫无反应（表现为「重新检查后无法更新」），
         真正在装的那一项也失去取消入口。busy / queuing 行不参与 registry 比对。 */
      function reconcileInstallStates() {
        if (busyName) { var b = findRow(busyName); if (b) { b.state = "busy"; b.why = ""; } }
        for (var i = 0; i < queue.length; i++) {
          var q = findRow(queue[i]);
          if (q) { q.state = "queuing"; q.why = ""; }
        }
      }

      var ERROR_CODE_TEXT = {
        "management-required": "该 profile 由桌面端独占管理，不能从这里安装",
        "unaddressable": "插件地址无法解析",
        "unknown-plugin": "未知插件",
        "invalid-spec": "安装 spec 非法",
        "ambiguous-install": "目标不明确，无法确定要装哪个包",
        "not-bundle": "该包不是 dsh 组合包（缺少 bundle patch）",
        "not-removable": "该包不可卸载",
        "stop-profile": "profile 正在停止，请稍后重试",
        "bundle-in-use": "插件正在使用中，无法替换",
        "stale-approval": "构建脚本授权已失效，需重新授权",
        "incompatible-version": "版本与当前 dsh 不兼容",
        "operation-error": "安装命令执行失败（pnpm 非零退出）"
      };
      /* failureText 与 coolingFromResult 都在文件上方的「纯函数区」里（错误码表作为
         参数传入），这里只保留这张码表；旧的长文案实现已删除，避免两份逻辑漂移。 */
      function lostReplyText(res) {
        var m = res && res.error && res.error.message;
        return "安装请求未返回结果" + (m ? "：" + String(m) : "");
      }

      function enqueue(name, opts) {
        if (name === busyName) { return; }        // 正在装它（行内已是「更新中」态）
        /* 冷静期行不得入队（第一道闸）：冷却期内安装要么被门禁拦下、要么在"有活要干"时
           先落地再报错，两种都不该由一次普通点击触发。只有走完「强制更新」流程（预检通过
           + 二次确认 + host 已把该版本写成生效豁免）才带 opts.force 放行；装前还有第二道
           闸 guardMaturity —— 行状态没来得及变成 cooling 时也拦得住。 */
        var grow = findRow(name);
        if (grow && grow.state === "cooling" && !(opts && opts.force)) { return; }
        if (busyName) {
          if (queue.indexOf(name) < 0) { queue.push(name); setRow(name, { state: "queuing" }); }
          return;
        }
        queue.push(name);
        pump();
      }
      function pump() {
        if (busyName) { return; }
        var name = queue.shift();
        if (!name) { return; }
        startOne(name);
      }
      /* 排队项取消：只把它自己摘出队列，其余照旧等待。 */
      function cancelQueued(name) {
        var i = queue.indexOf(name);
        if (i < 0) { return; }
        queue.splice(i, 1);
        setRow(name, { state: "update", why: "" });
      }

      function startOne(name) {
        var row = findRow(name);
        busyName = name;
        busyBefore = row ? row.version : "";
        busyLatest = (row && row.latest) || "";
        busyReq = uuid();
        setRow(name, { state: "busy", why: "" });
        emit();
        var pm = pickService(null, "remote.pluginManager");
        if (!pm) { finishOne(name, "failed", "remote.pluginManager 不可用"); return; }
        var settled = false;
        /* 看门狗只作兜底：正常路径一次调用就定案，不等它。 */
        var watchdog = setTimeout(function () {
          finish("unknown", "更新超时（240 秒未结束）；结果未知，请点「重新检查」确认");
          try { var pm2 = pickService(null, "remote.pluginManager"); if (pm2 && pm2.cancelInstall && busyReq) { pm2.cancelInstall(busyReq); } } catch (e) {}
        }, 240000);
        function finish(kind, why, meta) {
          if (settled) { return; }
          settled = true;
          clearTimeout(watchdog);
          finishOne(name, kind, why || "", meta);
        }
        function settle(st) {
          if (!st || typeof st !== "object") { finish("unknown", "安装未返回可判定的结果"); return; }
          var app = st.application;
          if (app === "applied") { finish("applied", ""); return; }
          if (app === "restart-required") { finish("applied", "已应用，重启桌面端后生效"); return; }
          if (app === "cancelled") { finish("cancelled", "已取消"); return; }
          if (app === "overridden") { finish("failed", "已被另一次安装覆盖，请重试"); return; }
          if (app === "failed") {
            /* 成熟期违规不是「更新失败」：落 cooling，并把反推出来的窗口记进会话缓存
               （预判复用）；那条长报错不渲染，改由 cooling 的可展开详情承担。 */
            var cool = coolingFromResult(st, Date.now(), policyWindowMs, ERROR_CODE_TEXT);
            if (cool) {
              if (isFinite(cool.windowMs) && cool.windowMs > 0) { policyWindowMs = cool.windowMs; }
              finish("cooling", "", cool);
              return;
            }
            finish("failed", failureText(st, ERROR_CODE_TEXT));
            return;
          }
          finish("unknown", "安装返回了无法识别的结果（application=" + String(app) + "）");
        }
        function lostReply(res) {
          var pm2 = pickService(null, "remote.pluginManager");
          var wait = pm2 && pm2.waitForInstall;
          if (!wait) { finish("unknown", lostReplyText(res) + "，且无法恢复，请点「重新检查」确认"); return; }
          Promise.resolve(wait.call(pm2, busyReq)).then(function (r) {
            var st = r && r.ok ? r.value : null;
            if (st) { settle(st); return; }
            finish("unknown", lostReplyText(res) + "；该请求已不在活动中，结果未知，请点「重新检查」确认");
          }).catch(function () {
            finish("unknown", lostReplyText(res) + "；恢复结果失败，请点「重新检查」确认");
          });
        }
        /* 成熟期硬闸：未成熟版本只有走「强制更新」才允许安装。
           为什么必须有它：精确版本 spec **会**让 pnpm 自动把该版本写进
           minimumReleaseAgeExclude 并照常安装（真机实测），所以"冷却期"光靠行状态拦点击
           是不够的 —— 预判还在飞的时候点「有新版本」就能把未成熟版本静默装进去（用户实测撞到）。
           放行凭据是 forcedNames（强制流程写入），用完即删。 */
        function abortForCooling(version, publishedAt, matureAt) {
          if (settled) { return; }
          settled = true;
          clearTimeout(watchdog);
          setRow(name, {
            state: "cooling", latest: version, why: "", publishedAt: publishedAt, matureAt: matureAt,
            detail: "安装前校验：registry 记录 " + version + " 发布于 " + new Date(publishedAt).toISOString() +
              "，仍在 minimumReleaseAge 窗口内（" + fmtWindow(policyWindowMs) + "），本次安装已拦下（未安装）。"
          });
          scheduleCoolingRefresh(name, matureAt);
          busyName = ""; busyReq = ""; busyBefore = ""; busyLatest = "";
          cancelling = false;
          emit();
          pump();
        }
        function guardMaturity(nm, version, go) {
          if (!version) { go(); return; }                                  // 版本未知（@latest 兜底路径）不拦
          if (forcedNames[nm]) { delete forcedNames[nm]; go(); return; }    // 强制流程显式放行
          fetchPackumentTimes(nm, function (res) {
            var pub = res && res.ok && res.time ? res.time[version] : NaN;
            if (!isFinite(pub)) { go(); return; }   // 拿不到发布时间就不拦：数据源不可用不该挡住正常更新
            var mature = pub + policyWindowMs;
            if (!isFinite(mature) || Date.now() >= mature) { go(); return; }
            abortForCooling(version, pub, mature);
          });
        }

        /* 安装 spec 用面板已解析的精确版本（`name@版本`），不用 @latest —— 装的就是
           面板显示的那个版本（精确版本会被 pnpm 自动豁免，见上面 guardMaturity 的说明）。
           行内没解析过则现场查 registry。 */
        var targetVersion = busyLatest;
        var specPromise = targetVersion
          ? Promise.resolve(name + "@" + targetVersion)
          : fetchLatest(name)
              .then(function (v) { var lv = v && v.version; if (lv) { targetVersion = lv; return name + "@" + lv; } return name + "@latest"; })
              .catch(function () { return name + "@latest"; });
        /* 保留原本的启用选择：不再一律 enabled:true（那会把用户手动禁用的插件重新启用）。 */
        var enabled = !(row && row.enabled === false);
        specPromise.then(function (spec) {
          return new Promise(function (resolve) {
            guardMaturity(name, targetVersion, function () { resolve(spec); });
          });
        }).then(function (spec) {
          return pm.installBundle(spec, { enabled: enabled, requestId: busyReq });
        }).then(function (res) {
          if (!res || res.ok === false) { lostReply(res); return; }
          settle(res.value);
        }).catch(function (e) { finish("failed", "安装请求失败：" + msgOf(e)); });
      }

      /* 终态落定：回读清单核对真实版本（registry 解析与 pnpm 实际安装可能不一致，
         如镜像源），再按 kind 决定文案。kind: applied | failed | cancelled | cooling
         | unknown；cooling 只由 settle 的成熟期违规分支给出（meta 带成熟时刻与详情）。
         回读只用 pluginManager.listBundles（pluginInventory 只有 list()，没有
         listBundles）；装完瞬间清单可能短暂不可用，重试 3 次（1.5s 间隔）再下结论。 */
      function finishOne(name, kind, why, meta) {
        var before = busyBefore;
        var latest = busyLatest;
        var pm = pickService(null, "remote.pluginManager");
        function done() {
          busyName = ""; busyReq = ""; busyBefore = ""; busyLatest = "";
          cancelling = false;
          delete forcedNames[name];   // 放行凭据只对一次安装生效，终态一律清掉
          emit();
          pump();
        }
        function judge(ver) {
          if (ver && ver !== before) {
            updatedCount++;   // 版本真的变了：装到盘上的已是新代码，运行中的进程还是旧的
            setRow(name, { version: ver, state: "current", latest: ver, why: "", publishedAt: NaN, matureAt: NaN, detail: "" });
            /* 安装真的落地了：顺手让 host 半边归并豁免表，免得陈旧条遮蔽下一次安装 */
            normalizeExcludes();
          } else if (kind === "cancelled") {
            /* 取消不是失败：该行仍有新版本，退回可再次更新的状态。 */
            setRow(name, { state: "update", latest: latest, why: "" });
          } else if (kind === "cooling") {
            /* 门禁在解析前整体中止了这次安装：落 cooling（不是 fail），也不贴那串长报错 */
            var m = meta || {};
            var patch = {
              state: "cooling", why: "", detail: m.detail || "",
              publishedAt: m.publishedAt, matureAt: m.matureAt
            };
            if (latest || m.version) { patch.latest = latest || m.version; }
            setRow(name, patch);
            scheduleCoolingRefresh(name, patch.matureAt);
          } else if (kind === "failed") {
            setRow(name, { state: "fail", why: why || "更新失败" });
          } else if (kind === "applied" && ver) {
            setRow(name, { state: "unchanged", why: "安装已应用，但版本未变化：可能 registry 与 pnpm 实际解析不一致（如配置了镜像源）" });
          } else {
            setRow(name, { state: "unconfirmed", why: why || "未能回读版本；点击重查确认" });
          }
          done();
        }
        function attempt(n) {
          if (!pm || !pm.listBundles) { judge(""); return; }
          Promise.resolve(pm.listBundles()).then(function (r) {
            var bundles = (r && r.ok && r.value) || [];
            if (!bundles.length && n < 3) { setTimeout(function () { attempt(n + 1); }, 1500); return; }
            var ver = "";
            for (var i = 0; i < bundles.length; i++) {
              if (bundles[i].name === name) { ver = bundles[i].version != null ? String(bundles[i].version) : ""; break; }
            }
            judge(ver);
          }).catch(function () {
            if (n < 3) { setTimeout(function () { attempt(n + 1); }, 1500); return; }
            judge("");
          });
        }
        attempt(0);
      }

      /* 取消：排队项只摘自己（cancelQueued）；在装项请求取消**本次**，队列保留，
         等它落定后 done() → pump() 自然接着装下一项。
         旧实现把整个 queue 清空，于是「等待更新」的项全部退回「有新版本」——
         这就是「取消一项后，等待的项不再开始、反而变回有新版本」的真因。 */
      function requestCancel() {
        if (!busyName || cancelling) { return; }
        cancelling = true;
        var name = busyName;
        setRow(name, { state: "busy", why: "正在取消 …" });
        emit();
        var pm = pickService(null, "remote.pluginManager");
        if (!pm || !pm.cancelInstall || !busyReq) {
          setRow(name, { state: "busy", why: "取消服务不可用，仍在等待它自行结束" });
          return;
        }
        Promise.resolve(pm.cancelInstall(busyReq)).then(function (r) {
          var status = r && r.ok && r.value ? r.value.status : "";
          if (status === "too-late") { setRow(name, { state: "busy", why: "已进入应用阶段，取消不了，正在等它结束" }); }
          else if (status === "not-running") { setRow(name, { state: "busy", why: "该请求已不在运行，等待结果回传" }); }
          /* status === "cancelled"：安装调用会以 application:"cancelled" 落定，不在此改状态 */
        }).catch(function (e) {
          setRow(name, { state: "busy", why: "取消请求失败：" + msgOf(e) + "；仍在等待它结束" });
        });
      }

      /* ---- 弹窗定位：贴着触发按钮，按上下可用空间选「下方 / 上方」，并夹住左右边界 ----
         两个弹窗（更新面板、重启弹窗）共用这一套，且都**不可拖动** —— 位置只有一个
         来源：触发它的那枚按钮。按钮被页面布局推走（滚动、窗口尺寸变化、插件页重排）
         时弹窗跟着走，不会有"拖到哪就钉在哪、之后再也不跟"的状态。 */
      var PANEL_GAP = 6, PANEL_MARGIN = 8;
      /* 兜底宽度：只在弹窗还没渲染、量不到布局时用 */
      var PANEL_WIDTH = 344, RST_WIDTH = 330;
      /* 量真实外框。调用方传的 width 只是 CSS 里的**内容宽**，而两个弹窗的盒模型并不一样：
         Shadow DOM 里拿不到官方全局的 box-sizing 复位，.rwrap 是 content-box 且带 12px
         padding → 实宽比常量多 26px，右缘会比按钮多探出 26px（.wrap 没有 padding，
         只多 2px 边框，所以看着是对齐的）。竖直方向同理：maxHeight 约束的是内容盒，
         不扣掉 padding+border，弹窗就会比算出来的空间高出 26px。两边都用实测值。 */
      function measuredBox(wrap, fallbackWidth) {
        /* 宽度用 getBoundingClientRect：和锚点矩形同一个坐标系，页面若带缩放也不会串 */
        var width = 0;
        try { width = wrap.getBoundingClientRect().width; } catch (e) {}
        if (!width) { width = wrap.offsetWidth || fallbackWidth; }
        var extraY = 0;
        try {
          var cs = window.getComputedStyle(wrap);
          var n = function (v) { var f = parseFloat(v); return isFinite(f) ? f : 0; };
          extraY = n(cs.paddingTop) + n(cs.paddingBottom) + n(cs.borderTopWidth) + n(cs.borderBottomWidth);
        } catch (e) {}
        return { width: width, extraY: extraY };
      }
      function placeNear(anchor, wrap, width, minHeight) {
        try {
          if (!wrap || wrap.hidden) { return; }
          var vw = window.innerWidth, vh = window.innerHeight;
          var r = null;
          if (anchor && anchor.getBoundingClientRect) { r = anchor.getBoundingClientRect(); }
          if (!r || (!r.width && !r.height)) { r = { right: vw - 16, top: 56, bottom: 56 }; }   // 按钮还没挂上：退回右上角
          var box = measuredBox(wrap, width);
          var outer = box.width;
          var left = Math.max(PANEL_MARGIN, Math.min(vw - outer - PANEL_MARGIN, r.right - outer));
          /* scrollHeight 是未被 maxHeight 夹过的自然高度：反复重排时判据不会漂 */
          var height = wrap.scrollHeight || wrap.offsetHeight || minHeight || 200;
          var below = vh - r.bottom - PANEL_GAP - PANEL_MARGIN;
          var above = r.top - PANEL_GAP - PANEL_MARGIN;
          /* 优先放下方；下方放不下（或不如上方宽裕）就翻到上方 */
          var useBelow = below >= Math.min(height, minHeight || 200) || below >= above;
          /* 不再把 room 强行抬到 120：按钮贴着视口上下边时那会突破边距，
             让弹窗（连同底部的「重启 dsh / 取消」）跑到视口外面去。
             真正的下限交给下面 maxHeight 的 60。 */
          var room = useBelow ? below : above;
          wrap.style.maxHeight = Math.max(60, room - box.extraY) + 'px';
          wrap.style.left = left + 'px';
          wrap.style.right = 'auto';
          wrap.style.top = (useBelow
            ? r.bottom + PANEL_GAP
            : Math.max(PANEL_MARGIN, r.top - PANEL_GAP - Math.min(height, room))) + 'px';
        } catch (e) {}
      }
      function wireKeyActivation(wrap) {
        wrap.addEventListener("keydown", function (e) {
          if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") { return; }
          var t = e.target;
          if (!t || !t.getAttribute || t.getAttribute("role") !== "button") { return; }
          e.preventDefault();   // Space 默认会滚动页面
          try { t.click(); } catch (e2) {}
        });
      }
      /* 收起更新面板：置位 + 隐藏，状态不动（后台的安装/检查继续跑） */
      function closePanel(refocus) {
        panelClosed = true;
        var w = liveWrap(PANEL_ID, ".wrap");
        if (w) { w.hidden = true; }
        /* 键盘：收起后把焦点还给触发它的那枚按钮。点外部收起的传 false ——
           焦点已经跟着用户点的地方去了，不该抢回来。 */
        if (refocus) { try { var b = document.getElementById(BTN_ID); if (b) { b.focus(); } } catch (e) {} }
      }
      /* 已经建出来且开着的弹窗；重排时不要顺手把它们创建出来 */
      function liveWrap(hostId, sel) {
        var host = document.getElementById(hostId);
        var w = host && host.shadowRoot ? host.shadowRoot.querySelector(sel) : null;
        return w && !w.hidden ? w : null;
      }
      /* 滚动/窗口变化时重排（rAF 合并，避免滚动风暴里反复测量） */
      var relayoutPending = false;
      function relayoutPanels() {
        if (relayoutPending) { return; }
        relayoutPending = true;
        var run = function () {
          relayoutPending = false;
          var rw = liveWrap(RST_PANEL_ID, '.rwrap');
          if (rw) { placeNear(rstBtn, rw, RST_WIDTH, 180); }
          var pw = liveWrap(PANEL_ID, '.wrap');
          if (pw) { placeNear(document.getElementById(BTN_ID), pw, PANEL_WIDTH, 220); }
        };
        try { if (typeof requestAnimationFrame === 'function') { requestAnimationFrame(run); return; } } catch (e) {}
        setTimeout(run, 0);
      }
      try {
        window.addEventListener('resize', relayoutPanels);
        /* 面板自己内部滚动（.rows）不影响按钮位置，不必重排；用 composedPath 认出来 */
        window.addEventListener('scroll', function (e) {
          if (e && typeof e.composedPath === 'function') {
            var path = e.composedPath();
            for (var i = 0; i < path.length; i++) {
              var n = path[i];
              if (n && n.id && (n.id === PANEL_ID || n.id === RST_PANEL_ID)) { return; }
            }
          }
          relayoutPanels();
        }, true);
      } catch (e) {}

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
          "[role=\"button\"]:focus-visible{" + FOCUS_RING + "}" +
          ".hd{display:flex;align-items:center;gap:8px;padding:10px 12px;flex:0 0 auto;" +
          "border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.22));" +
          "user-select:none;-webkit-user-select:none}" +
          ".hd b{flex:1;font-size:13px;font-weight:600}" +
          ".x{cursor:pointer;opacity:.55;font-size:17px;line-height:1;padding:0 3px}" +
          ".x:hover{opacity:1}" +
          ".rows{flex:1 1 auto;min-height:0;overflow:auto}" +
          ".rowwrap{border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.12))}" +
          ".rowwrap:last-child{border-bottom:0}" +
          ".row{display:flex;align-items:center;gap:8px;padding:7px 12px}" +
          ".why{padding:0 12px 8px;font-size:12px;line-height:1.45;opacity:.7;word-break:break-word;white-space:pre-wrap}" +
          ".dtl{margin-top:4px;padding-top:6px;border-top:1px dashed var(--dsw-alias-border-l2,rgba(128,128,128,.28))}" +
          ".dtxt{font-size:11px;opacity:.62}" +
          /* 详情块内右下角的「强制更新」入口与二次确认（橙色强调 = 可操作）。
             刻意不加分隔线：与上面的说明文字留一段接近行距的距离即可。 */
          ".force{margin-top:8px}" +
          ".fb{font-weight:600;font-size:12px}" +
          ".fn{margin-top:4px;font-size:12px;line-height:1.5;opacity:.85}" +
          ".fi{margin:3px 0 0 8px;font-size:12px;opacity:.9;font-variant-numeric:tabular-nums}" +
          ".fbrow{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}" +
          ".force>*:first-child{margin-top:0}" +
          ".fbtn{display:inline-block;cursor:pointer;font-size:12px;padding:4px 12px;border-radius:999px;" +
          "border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4))}" +
          ".fbtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14))}" +
          ".fcheck{background:rgba(255,138,0,.16);border-color:rgba(255,138,0,.45);color:#f0a35e;font-weight:600}" +
          ".fcheck:hover{background:rgba(255,138,0,.26)}" +
          ".fgo{background:rgba(255,138,0,.22);border-color:rgba(255,138,0,.6);color:#ffb066;font-weight:600}" +
          ".fgo:hover{background:rgba(255,138,0,.32)}" +
          ".nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
          ".ver{opacity:.6;font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums}" +
          ".tag{font-size:11px;padding:1px 7px;border-radius:999px;white-space:nowrap;" +
          "border:1px solid transparent;flex:0 0 auto;cursor:not-allowed}" +
          ".tag.update{background:rgba(255,138,0,.16);color:#f0a35e;border-color:rgba(255,138,0,.32)}" +
          ".tag.current{background:rgba(62,207,142,.14);color:#4fbf8b;border-color:rgba(62,207,142,.28)}" +
          ".tag.other{background:rgba(128,128,128,.14);opacity:.85}" +
          ".tag.busy{opacity:.6}" +
          ".tag.error{background:rgba(255,80,80,.14);color:#e07070;border-color:rgba(255,80,80,.28)}" +
          ".tag.cooling{background:rgba(90,160,255,.16);color:#74b0ff;border-color:rgba(90,160,255,.34)}" +
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
          /* Auto review 提醒条：琥珀色，和「强制更新」同一语义色系（提示而非报错） */
          ".warn{flex:0 0 auto;padding:6px 12px;font-size:12px;line-height:1.5;" +
          "background:rgba(255,138,0,.12);color:#f0a35e;" +
          "border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.18))}" +
          ".restart{flex:0 0 auto;padding:6px 12px;font-size:12px;line-height:1.5;" +
          "background:rgba(62,207,142,.12);color:#4fbf8b;" +
          "border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.18))}" +
          ".foot{padding:8px 12px;font-size:11px;line-height:1.5;opacity:.6;" +
          "border-top:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.12))}" +
          "</style><div class=\"wrap\" role=\"dialog\" aria-label=\"插件更新\" tabindex=\"-1\" hidden></div>";
        var wrap = sr.querySelector(".wrap");

        /* 不可拖动：位置完全由 placeNear() 决定（见文件上方的「弹窗定位」）。
           旧版支持拖拽并记忆位置，出现过"拖过一次就再也不跟按钮/不跟滚动"的问题，
           现已整段移除 —— 标题栏也不再显示移动光标。 */

        /* 点击外部收起（捕获段，按下即收） */
        document.addEventListener("pointerdown", function (e) {
          var w = document.getElementById(PANEL_ID);
          if (w !== host) { return; }
          var cur = host.shadowRoot.querySelector(".wrap");
          if (!cur || cur.hidden) { return; }
          if (host.contains(e.target)) { return; }
          var chkBtn = document.getElementById(BTN_ID);
          if (chkBtn && (chkBtn === e.target || chkBtn.contains(e.target))) { return; }
          closePanel();
        }, true);
        document.addEventListener("keydown", function (e) {
          if (e.key !== "Escape") { return; }
          var cur = host.shadowRoot.querySelector(".wrap");
          if (cur && !cur.hidden) { closePanel(true); }
        });

        /* 行内点击委托：有新版本 → 入队；更新中/等待 → 取消；失败 → 重试 */
        wrap.addEventListener("click", function (e) {
          var t = e.target;
          if (!t || !t.classList) { return; }
          if (t.classList.contains("x")) { closePanel(true); return; }
          if (t.classList.contains("recheck")) { if (!checking) { checkNow(); } return; }
          if (t.classList.contains("reverify")) { if (!checking) { checkNow(); } return; }
          if (t.classList.contains("allbtn")) {
            rows.forEach(function (r) { if (r.state === "update" && queue.indexOf(r.name) < 0 && r.name !== busyName) { enqueue(r.name); } });
            return;
          }
          if (t.classList.contains("cooling")) {
            /* 冷静期标签：只展开 / 收起详情，绝不触发安装 */
            var nm0 = t.getAttribute("data-n");
            if (nm0) { revealedCooling[nm0] = !revealedCooling[nm0]; paint(); }
            return;
          }
          /* 强制更新（跳过冷静期）三步：入口 → 预检 → 二次确认 → 写生效豁免 + 安装 */
          if (t.classList.contains("fcheck")) {
            var nf = t.getAttribute("data-n");
            if (nf) { forceCheck(nf); }
            return;
          }
          if (t.classList.contains("fgo")) {
            var ng = t.getAttribute("data-n");
            if (ng) { forceGo(ng); }
            return;
          }
          if (t.classList.contains("fcancel")) {
            var nc2 = t.getAttribute("data-n");
            if (nc2) { forceReset(nc2); paint(); }
            return;
          }
          if (t.classList.contains("act")) {
            var nm = t.getAttribute("data-n");
            if (nm) { enqueue(nm); }
            return;
          }
          if (t.classList.contains("cancel")) {
            var nmc = t.getAttribute("data-n");
            if (nmc && nmc !== busyName) { cancelQueued(nmc); } else { requestCancel(); }
            return;
          }
          if (t.classList.contains("retry")) {
            var nm2 = t.getAttribute("data-n");
            checkOne(nm2);
          }
        });

        wireKeyActivation(wrap);

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
              r.latest = v && v.version ? v.version : "";
              r.requiresDsh = (v && v.requiresDsh) || "";
              r.state = newerState(r.latest, r.requiresDsh, r.version);
              emit();
              if (r.state === "update") { applyCoolingGuess(name); }
            }).catch(function (e) {
              setRow(name, e && e.notFound ? { state: notFoundState(cur), why: String(e.message) } : { state: "error", why: String(e && e.message || e) });
            });
            return;
          }
        }
      }

      var TAG_TEXT = {
        checking: "比对中 …", current: "已是最新", update: "有新版本", dsh: "DSH 不符",
        local: "本地链接", remote: "Git 直装", unknown: "无法比对", error: "检查失败", queuing: "等待更新",
        busy: "更新中 …", unchanged: "暂缓更新", unconfirmed: "未能确认", fail: "更新失败",
        cooling: "冷静期中"
      };
      function tagHtml(r) {
        var cls = "tag other", act = "", title = "";
        if (r.state === "update") { cls = "tag update act clickable"; act = " data-n=\"" + esc(r.name) + "\""; title = " title=\"点击更新到最新版\""; }
        else if (r.state === "current") { cls = "tag current"; }
        /* 兼容门禁：悬停才说清「需要 DSH ≥ x」，标签本身不可点 */
        else if (r.state === "dsh") { cls = "tag error"; title = " title=\"需要 DSH ≥ " + esc(r.requiresDsh || "更高版本") + "，请先升级 dsh 再更新\""; }
        else if (r.state === "error") { cls = "tag error retry clickable"; act = " data-n=\"" + esc(r.name) + "\""; title = " title=\"" + esc(r.why || "检查失败") + "（点击重查）\""; }
        else if (r.state === "local") { title = " title=\"" + esc(r.src || r.why || "本地直装") + "；没有可比的 registry 版本\""; }
        else if (r.state === "remote") { title = " title=\"" + esc(r.src || r.why || "Git/URL 直装") + "；没有可比的 registry 版本\""; }
        else if (r.state === "unknown") { title = " title=\"" + esc(r.why || "插件清单未提供已装版本") + "，因此无法与 registry 比对\""; }
        else if (r.state === "queuing") { cls = "tag other cancel clickable"; act = " data-n=\"" + esc(r.name) + "\""; title = " title=\"点击取消排队\""; }
        else if (r.state === "busy") { cls = "tag other cancel clickable"; act = " data-n=\"" + esc(r.name) + "\""; title = " title=\"" + esc(r.why ? r.why + "；" : "") + "点击取消本次更新\""; }
        /* cooling：标签只切换详情，绝不触发安装；真正的拦截在 enqueue（入队闸）与
           startOne 的 guardMaturity（装前硬闸，未成熟版本只有强制流程能过） */
        else if (r.state === "cooling") { cls = "tag cooling clickable"; act = " data-n=\"" + esc(r.name) + "\""; title = " title=\"冷静期中：点开看详情，不会触发安装\""; }
        else if (r.state === "fail") { cls = "tag error act clickable"; act = " data-n=\"" + esc(r.name) + "\""; title = " title=\"" + esc(r.why || "更新失败") + "（点击重试）\""; }
        else if (r.state === "unchanged") { cls = "tag update act clickable"; act = " data-n=\"" + esc(r.name) + "\""; title = " title=\"" + esc(r.why || "") + "（点击重试）\""; }
        else if (r.state === "unconfirmed") { cls = "tag other reverify clickable"; title = " title=\"" + esc(r.why || "") + "（点击重查）\""; }
        return "<span class=\"" + cls + "\"" + act + title + (cls.indexOf("clickable") >= 0 ? KBD : "") + ">" + esc(TAG_TEXT[r.state] || "未比对") + "</span>";
      }
      /* ---- 「Auto review」访问模式提示（只提示，不改任何设置）--------------------
         DSH 0.2.0-rc.2 的已知缺陷：访问模式为 auto 的会话会让 permissionPresets 服务在
         热重载（装/更新插件就会触发）时构造失败 —— 表现是装插件报一长串错、助手侧也随之
         一连串报错，且要重启客户端才恢复。这里只读当前是否有这种会话，用来提醒用户先切走。
         读法同官方权限面板：sessions 列表 → binding(id).session → permissions 投影。
         拿不到服务/投影（老版本 dsh、会话未驻留）就返回 false，宁可不提示也不误报。 */
      function hasAutoReviewSession() {
        try {
          var svc = (ctx && typeof ctx.get === "function") ? ctx.get("sessions") : null;
          if (!svc) { svc = pickService(null, "sessions"); }
          var store = svc && svc.list;
          if (!svc || !store || typeof store.getSnapshot !== "function" || typeof svc.binding !== "function") { return false; }
          var snap = store.getSnapshot() || {};
          var ids = snap.ids || [];
          for (var i = 0; i < ids.length; i++) {
            var live = null;
            try { live = svc.binding(ids[i]); } catch (e0) { live = null; }
            var sess = live && live.session;
            var face = sess && sess.projections && typeof sess.projections.faceOf === "function"
              ? sess.projections.faceOf("permissions") : null;
            var val = face && typeof face.getSnapshot === "function" ? face.getSnapshot() : null;
            if (val && val.currentValue === "auto") { return true; }
          }
        } catch (e) {}
        return false;
      }
      function accessModeBar() {
        if (!hasAutoReviewSession()) { return ""; }
        return "<div class=\"warn\">⚠ 有会话正在用「Auto review」访问模式：这个模式下装/更新插件有时会失败，并且助手这边会开始一连串报错，要重启客户端才能恢复。建议先把该会话切换成「工作区内修改」，装完再切回「Auto review」。</div>";
      }

      function paint() {
        var wrap = panelWrap();
        var upd = 0;
        /* 有成功更新就常驻提示：装到盘上的是新代码，运行中的还是旧的，
           不重启（桌面端）/不重启 dsh 并强刷（web 端）就不会生效。 */
        function restartBar() {
          if (!updatedCount) { return ""; }
          return "<div class=\"restart\">已更新 " + updatedCount + " 个插件，" +
            (isDesktop ? "重启客户端后生效" : "重启 dsh 服务并刷新页面后生效") + "</div>";
        }
        rows.forEach(function (r) { if (r.state === "update") { upd++; } });
        var allBtn = upd ? "<span class=\"allbtn\"" + KBD + ">全部更新（" + upd + "）</span>" : "<span class=\"allbtn\" hidden></span>";
        var body;
        if (!rows.length) {
          body = "<div class=\"msg\">" + (checking ? "正在读取插件清单…" : "点上方「重新检查」开始比对") + "</div>";
        } else {
          body = rows.map(function (r) {
            var showLatest = r.state === "update" || r.state === "dsh" || r.state === "unchanged" || r.state === "fail" || r.state === "cooling";
            var ver = r.latest && showLatest ? r.version + " → " + r.latest : r.version;
            /* cooling 的副标题是现算的（绝对成熟时刻 + 相对剩余时间），不在 r.why 里 */
            var why = r.state === "cooling"
              ? coolingWhyText({ version: r.latest || r.version, windowMs: policyWindowMs, publishedAt: r.publishedAt, matureAt: r.matureAt, nowMs: Date.now() })
              : r.why;
            var sub = why && (r.state === "fail" || r.state === "unchanged" || r.state === "unconfirmed" || r.state === "error" || r.state === "cooling")
              ? "<div class=\"why\">" + esc(why) + "</div>" : "";
            /* 详情只在点开 cooling 标签后渲染：默认只留一句话，完整解释不占第一屏 */
            var dtl = r.state === "cooling" && revealedCooling[r.name]
              ? "<div class=\"why dtl\"><div class=\"dtxt\">" + esc(coolingReasonText(r.detail, policyWindowMs)) + "</div>" + forceArea(r) + "</div>" : "";
            return "<div class=\"rowwrap\"><div class=\"row\">" +
              "<span class=\"nm\" title=\"" + esc(r.name) + "\">" + esc(r.name) + "</span>" +
              "<span class=\"ver\" title=\"" + esc(ver) + "\">" + esc(ver) + "</span>" +
              tagHtml(r) + "</div>" + sub + dtl + "</div>";
          }).join("");
        }
        var html = "<div class=\"hd\"><b>插件更新 · " + (busyName ? "正在更新 " + esc(busyName) + " …" : (checking ? "检查中…" : (rows.length ? upd + " 个插件有新版本" : "插件更新检查"))) + "</b>" +
          "<span class=\"recheck\"" + KBD + " title=\"重新读取插件清单并比对 registry\">重新检查</span>" + allBtn +
          "<span class=\"x\"" + KBD + " title=\"关闭\" aria-label=\"关闭\">×</span></div>" + restartBar() + accessModeBar() + "<div class=\"rows\">" + body + "</div>" +
          /* 面板脚注：把「只查第三方」这条口径写在明处（plugin-manager 同款一句） */
          "<div class=\"foot\">只检查第三方插件；官方 @deepseek-ai/ 包随 DSH 本体升级。</div>";
        if (wrap.innerHTML !== html) {
          var keep = wrap.querySelector(".rows");
          var st = keep ? keep.scrollTop : 0;
          wrap.innerHTML = html;
          var nk = wrap.querySelector(".rows");
          if (nk && st) { nk.scrollTop = st; }
        }
        /* 收起状态下只更新内容，不把它弹回来 —— 显示由「打开」路径负责 */
        if (!panelClosed) {
          wrap.hidden = false;
          /* 位置只有一个来源：那枚「检查更新」按钮（不可拖动） */
          placeNear(document.getElementById(BTN_ID), wrap, PANEL_WIDTH, 220);
        }
      }

      /* ---- 列表级按钮：挂官方插件页「已安装」标题那一行的右侧 -----------------
         那个标题是页面自己的 chrome，没有为它声明插槽席位（扩展点是 plugins.detail.* /
         plugins.item / plugins.bundle.config 这些），所以只能直接找 DOM：
         `[data-plugin-panel] [data-plugin-group="bundles"]` 的第一个子元素就是「已安装」
         标题行（plugin-manager 用的同一个座位），把按钮塞进去、靠 margin-left:auto 靠右。
         按钮样式用 dsh 的主题变量自绘 —— 座位那一行里没有官方按钮可当模子，自绘也顺带
         能给出状态语义：「立即重启」常带一圈绿色内描边。
         React 重渲染会抹掉手插节点，MO + 轮询兜底补挂。---- */
      var BOX_ID = 'dshuiw-list-actions';
      var LIST_CSS_ID = 'dshuiw-list-actions-css';
      function ensureListCss() {
        if (document.getElementById(LIST_CSS_ID)) { return; }
        var st = document.createElement('style');
        st.id = LIST_CSS_ID;
        st.textContent =
          '#' + BOX_ID + '{align-self:center;margin-left:auto;display:flex;align-items:center;gap:8px}' +
          '#' + BOX_ID + ' button{font:inherit;cursor:pointer;font-size:12.5px;line-height:18px;padding:3px 10px;' +
          'border-radius:6px;border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.5));' +
          'color:var(--dsw-alias-label-primary,inherit);background:transparent;white-space:nowrap}' +
          '#' + BOX_ID + ' button:hover:enabled{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14))}' +
          '#' + BOX_ID + ' button:disabled{cursor:default;opacity:.55}' +
          /* 焦点环：这两枚是页面里自绘的 <button>，官方全局样式不会替它们画焦点，
             键盘用户 Tab 过来时看不见落点（面板内部同样有一条，见两处 shadow 样式） */
          '#' + BOX_ID + ' button:focus-visible{' + FOCUS_RING + '}' +
          /* 「立即重启」用危险色：它是本插件里唯一会动进程、会打断进行中任务的按钮 */
          '#' + RBTN_ID + '{color:var(--dsw-alias-label-danger,#e07070);box-shadow:inset 0 0 0 1px rgba(255,80,80,.5)}' +
          '#' + RBTN_ID + ':hover:enabled{background:rgba(255,80,80,.12)}';
        try { document.head.appendChild(st); } catch (e) {}
      }
      /* 「已安装」标题行；不在这个页面（或官方改了结构）时返回 null，按钮就不挂 */
      function findSeat() {
        var panel = document.querySelector('[data-plugin-panel]');
        var group = panel ? panel.querySelector('[data-plugin-group="bundles"]') : null;
        var head = group ? group.firstElementChild : null;
        return head instanceof HTMLElement ? head : null;
      }
      function mkBtn(id, label, title, onClick) {
        var b = document.createElement('button');
        b.type = 'button';
        b.id = id;
        b.textContent = label;
        b.title = title;
        b.addEventListener('click', onClick);
        return b;
      }
      function mountButton(openPanel, onRestart) {
        function mount() {
          var seat = findSeat();
          if (!seat) { return false; }
          ensureListCss();
          var box = document.getElementById(BOX_ID);
          if (!box) { box = document.createElement('span'); box.id = BOX_ID; }
          var chk = document.getElementById(BTN_ID);
          var rst = document.getElementById(RBTN_ID);
          if (!chk) { chk = mkBtn(BTN_ID, '检查更新', '比对全部已装插件与 npm registry 的版本（不含 dsh 本体）', openPanel); }
          if (!rst) { rst = mkBtn(RBTN_ID, '立即重启', '重启 dsh 让刚更新的插件生效；桌面端会先退出，再由客户端弹出重启对话框', onRestart); }
          if (chk.parentElement !== box) { box.appendChild(chk); }
          if (rst.parentElement !== box) { box.appendChild(rst); }
          if (box.parentElement !== seat) { seat.appendChild(box); }
          rstBtn = rst;   // 重启弹窗按这枚按钮定位
          return true;
        }
        mount();
        try {
          var mo = new MutationObserver(function () { mount(); });
          mo.observe(document.documentElement, { childList: true, subtree: true });
        } catch (e) {}
        setInterval(mount, 2000);
      }

      mountButton(
        function () { panelClosed = false; paint(); if (!rows.length && !checking) { checkNow(); } },
        function () { onRestartClick(); }
      );
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
