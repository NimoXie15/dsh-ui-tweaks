# 开发笔记

面向改这个插件的人。用户文档在 [README.md](./README.md)。

## 骨架（与 dsh-model-organizer 同构）

- `lib/index.js`：host 半区，空 `apply()`，只为让插件出现在 cordis loader / bundle 列表。
- `lib/client.js`：浏览器半区，`window.__ModuleLoader__.load({ id, factory })` 包裹，`module.exports = { name, apply, inject }`；`apply(ctx)` 由客户端 cordis 上下文调用。
- `cordis.patch.yml`：`- insert: [{id: ui-tweaks, name: '@nimoxie/dsh-ui-tweaks'}]`。**profile bundle 必须声明 `dsh.bundle.patch`，否则 dsh 启动即报 declares no dsh.bundle**。
- `package.json`：`exports["./client"]` 指向 client bundle；`dsh.client.platform: "web"`；`dsh.client.inject` 列出需要的官方包（本插件只要 `@deepseek-ai/dsh-api-remotes`，`remote.*` 服务由它提供）。
- 客户端可用模块：`react` / `react-dom` / `@deepseek-ai/dsh-client-ui-primitives` 都是 shell 内置（PLATFORM_MODULES），不需要 `external` 声明。本插件 v1 没用 React。

### 命名（scoped 后的约定，2026-09-30 因重名加 @nimoxie scope）

- npm 包名 `@nimoxie/dsh-ui-tweaks`；**patch 里的 `insert.name` 必须写全 scope** —— `@linxin666` 系插件全是这样（loader 按它在 node_modules 里解析包）。
- loader `id` 与 `module.exports.name` 只是内部标识，换名不必跟着改（dsh-model-organizer 改 scoped 后这俩仍是旧值，工作正常）；本插件 loader id 用了全名，`exports.name` 用 `ui-tweaks`。
- 换名要同步四处：package.json、cordis.patch.yml、两个 profile 的依赖键 + `dsh.profile.bundles` 数组、（桌面 profile 还有 lockfile 与 node_modules 软链路径）。

## 本地开发（link: 才是软链！）

- **`file:` 依赖是打包快照，`link:` 才是符号链接。** profile 里写 `file:` 时 pnpm 把目录复制进 store，改仓库不生效。
- 安装/重装：
  ```sh
  dsh plugin --profile web remove @nimoxie/dsh-ui-tweaks
  dsh plugin --profile web add "link:D:/tools/DeepSeek Harness/dsh-ui-tweaks"
  ```
- 改完 client.js 后页面要 **Ctrl+Shift+R**：客户端 bundle 以 `Cache-Control: immutable, max-age=31536000` 下发且 URL 不随代码变化，普通刷新一直吃缓存。
- 加载/卸载插件需要**重启 dsh web**（插件在启动时装载）。
- **桌面 profile 由 Electron 应用独占管理**：npm 版 CLI 装/卸会被拒（`managed exclusively by the Electron application`）。两条路：① 客户端插件管理页安装，spec 填 `link:<路径>`；② 应用完全退出后手动改四件套（package.json 依赖 + `dsh.profile.bundles`、pnpm-lock importers、node_modules 软链）。实测客户端会监听 package.json 变化、自动用自带 pnpm 建好软链。

## 已知坑（多半继承自 dsh-model-organizer 的踩坑记录）

- **`ctx.inject([...])` 只要有一个服务名不存在，回调永远不执行且不报错**。升级 dsh 后功能静默消失，第一件事去新版 `dsh-client-ui-*` 包里 grep 注入的每个服务名。本插件在 8 秒拿不到服务时会给出明确的错误行，不会无限等。
- 每个模块的注册各套 `guard()`：失败记 `console.warn`，不拖垮同文件其它模块。
- 官方 CSS-module 类名是「哈希_原名」结构，锚定一律用**属性前缀**（`[class*="tableScroll"]`、`[class*="widthHandle"]`、`[class*="composerSeat"]`），绝不硬编码 hash。
- **0.2.0-rc.1 已把 0.1.x 的 `data-dsh-part` 标记全部移除**（滚动条/调宽条/输入框的选择器都因此改过一轮）；`[data-slot="..."]` 是渲染器统一输出的，锚插槽容器用它。
- 浮层挂在 `document.body` 的 Shadow DOM 里：座位在页面深子树里时 `position:fixed` 会被困在堆叠上下文，z-index 再高也没用。

## 更新检查的实现要点

- **全部走官方 remote API**，不自建 host 路由：`pluginManager.listBundles()`（清单+版本）、`installBundle("<名>@latest", { enabled: true, requestId })`（更新）、`waitForInstall(requestId)`（进度）、`cancelInstall(requestId)`（取消）。`installBundle` 的第二参里官方传了 `registry`（来自 `pluginManager.registries()`），本插件省略 —— 若某天报 registry 缺失，先补这个。
- **registry 比对在浏览器直连**：`registry.npmjs.org` 带 `Access-Control-Allow-Origin: *`（2026-09 实测），逐包串行 fetch `/latest`，不给 registry 打并发。
- **装完必须回读实际版本**：pnpm 11 的 `minimumReleaseAge` 门禁会静默暂缓当日发布，只看安装请求成功会把「没装上」报成「成功」。回读**只用 `pluginManager.listBundles()`** —— `pluginInventory` 只有 `list()` 没有 `listBundles`，先取它会掉进「回读版本失败」假阳性（踩过）；装完瞬间清单可能短暂不可用，重试 3 次（1.5s 间隔）再下结论。重试后仍读不到就标「已发起·未确认」（可点重查），版本没变才标「暂缓更新」。
- **本地包识别 = host 路由为主，404 签名兜底**：`listBundles()` 不透传安装来源（`installed` 不是 spec 字符串），而发布到 npm 的本地包（如 `@nimoxie/dsh-model-organizer`）连 404 签名都不命中 —— 所以 host 半区挂了 `GET /api/ui-tweaks/local-plugins`（读 profile `package.json` 的 dependencies，把 `link:/file:/git+/http` 声明的包名回给面板；仅回环放行）。client 每轮检查先取这份名单标「本地链接」，取不到（host 半区未重启）再退回 404 签名。**改 host 半区必须重启 dsh/客户端才生效**（client bundle 刷新即可）。
  profile 目录定位：先从 `import.meta.url` 向上找带 `dsh.profile.bundles` 且包含自身的 package.json（npm 直装必命中）；软链安装时模块被解析到 profile 外的真实目录，退回 `DSH_HOME/profiles/*` 扫描，多 profile 命中时按 `ELECTRON_RUN_AS_NODE` 区分 desktop/web。
- **更新严格串行**：pnpm 对 profile 的 package.json 有文件锁，并发发起不会真并行、只会在锁上排队。队列里的项标「等待更新」，正在装的标「更新中 …」，两者都可点取消。
- `waitForInstall` 的返回形态官方页面之外没有文档，本插件对 `phase/state/status/ok` 多形状都认、240 秒兜底超时；真实跑通后按实际返回收紧。
- **刻意不检查 dsh 本体**（用户决策）：桌面端自带更新器，web 端本体升级走 npm。

## 动画修复的实现要点（模块 4）

- **原理**：Windows「动画效果」关闭 → Chromium 报 `prefers-reduced-motion: reduce` → dsh 的 40 处（17 包）`@media` 规则关掉动画。页面内**删不掉媒体查询的求值**，但删得掉规则本身：dsh 的 CSS 全部经 `<style>` 标签注入（实测 0 处 adoptedStyleSheets），同源 sheet 的 `cssRules` 可遍历可 `deleteRule` —— 把 reduce 的 media 块整条递归删除，基础动画声明（非 media 规则）立即生效。效果与 dsh-web-shell 的 CDP `Emulation.setEmulatedMedia` 等价，但**不需要调试端口，桌面端也能用**。
- **JS 门控**：chat 包 3 处 `matchMedia("(prefers-reduced-motion: reduce)")`（滚动平滑 vs 跳转）用 `window.matchMedia` 包装覆盖 —— 在返回的 MediaQueryList 上 `defineProperty("matches")` 影子化，按 no-preference 应答。包装必须在应用渲染前生效（本插件 apply 在合成期，早于挂载）。
- **晚到样式**：分包懒加载/换肤重写都靠 `MutationObserver(head)` 防抖重扫 + 2s 轮询兜底（纯 CSSOM 枚举，无布局开销）。
- **取舍**：与 dsh-web-shell 的 `forceAnimations` 相同 —— 覆盖系统无障碍设置。窗口级覆盖（启动器）换成了会话级覆盖（插件），想恢复系统行为就得停用本插件；若将来要做成可开关，参考 dsh-model-organizer 的设置卡座位。
- web 窗口里本模块与 dsh-web-shell 的 CDP 覆盖并存是**无害冗余**（都指向 no-preference）。

## 从 dsh-web-shell 迁移的功能（2026-09-30）

对话区左侧滚动条与宽表格修复原是 dsh-web-shell 的 CDP 注入脚本，已整体迁入本插件（client bundle 自由 JS），dsh-web-shell 自身删除了对应代码与 `leftScrollbar` / `tableWidthFix` 配置。迁移时保留的全部实现要点都在 `lib/client.js` 各模块的注释里（宿主挂 body 的理由、composerSeat 裁剪 −4px、拖动三层防御、零位移 wheel 解阅读锚点、出血布局三件套等），此处不重复；下面只记两块迁移后才成立的知识：

- **「检查更新」按安装来源分流**：dsh-web-shell 时代来源由 PowerShell 读 profile 依赖判定；迁入插件后走 host 路由（见「更新检查的实现要点」）。
- **判断 dsh 是否已修宽表格**（决定何时删除模块 1）：打开含 ≥4 列表格的会话，控制台执行 `getComputedStyle(document.querySelector('[class*="tableScroll"]')).maxWidth` —— 若不再是 `100%`（或包裹层不再越界）说明官方已修，删除 `installTableWidthFix` 函数及其 `apply` 里的 guard 行即完全回滚。

## 待办 / 路线

- [ ] 入口按钮从「会话头部 utilities」迁到 `sidebar.footer.action`（常驻可见，@linxin666/dsh-update 用同一个座位）—— 需先验证空座位容器是否也渲染 `data-slot` 锚点。
- [ ] 有更新时按钮加角标（现在要点开面板才看到）。
- [ ] i18n（`ctx.locale.register(NS, {zh, en})`，照 dsh-model-organizer 的写法）。
- [ ] 第 3 优化点：会话内「重启 dsh」按钮（需要 host 侧配合或官方重启 API，未调研）。
- [ ] `waitForInstall` 终态按实测收紧；`installBundle` 的 registry 参数补齐。
- [ ] 插件被禁用/卸载时的运行时清理（目前 DOM 残留到页面刷新为止）。
