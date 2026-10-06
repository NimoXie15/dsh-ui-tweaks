# 开发笔记

面向改这个插件的人。用户文档在 [README.md](./README.md)。

## 骨架（与 dsh-model-organizer 同构）

- `lib/index.js`：host 半区，空 `apply()`，只为让插件出现在 cordis loader / bundle 列表。
- `lib/client.js`：浏览器半区，`module.exports = { name, apply, inject }`；`apply(ctx)` 由客户端 cordis 上下文调用。
- `cordis.patch.yml`：`- insert: [{id: ui-tweaks, name: '@nimoxie/dsh-ui-tweaks'}]`。**profile 必须声明 `dsh.bundle.patch`，否则 dsh 启动即报 declares no dsh.bundle**；**insert.name 必须写全 scope**（loader 按它在 node_modules 解析包）。
- `package.json`：`exports["./client"]` 指向 client bundle；`dsh.client.platform: "web"`；inject 只需 `@deepseek-ai/dsh-api-remotes`（`remote.*` 服务由它提供）。`react` / `react-dom` 等是 shell 内置（PLATFORM_MODULES），不用声明。
- loader `id` 与 `exports.name` 只是内部标识，可以不跟包名走（换名也不用改）；真正要同步四处的是 package.json、cordis.patch.yml、两个 profile 的依赖键 + `dsh.profile.bundles`、（桌面 profile 还有 lockfile 与 node_modules 软链路径）。

## 本地开发

- **`file:` 是打包快照，`link:` 才是符号链接**：写 `file:` 时 pnpm 把目录复制进 store，改仓库不生效。
- 安装/重装：
  ```sh
  dsh plugin --profile web remove @nimoxie/dsh-ui-tweaks
  dsh plugin --profile web add "link:<本仓库绝对路径>"
  ```
- 改完 client.js 后页面要 **Ctrl+Shift+R**（bundle 以 `Cache-Control: immutable` 下发且 URL 不随代码变化，普通刷新一直吃缓存）。加载/卸载插件需要**重启 dsh web**。
- **桌面 profile 由 Electron 独占管理**：npm 版 CLI 装/卸会被拒（对它的报错是 `managed exclusively by the Electron application`）。两条路：① 客户端插件管理页安装，spec 填 `link:<路径>`；② 应用完全退出后手动改四件套（package.json 依赖 + `dsh.profile.bundles`、pnpm-lock importers、node_modules 软链）。客户端会监听 package.json 变化、自动用自带 pnpm 建好软链。

## 已知坑

- **`ctx.inject([...])` 只要有一个服务名不存在，回调永远不执行且不报错**。升级 dsh 后功能静默消失，第一件事去新版 `dsh-client-ui-*` 包里 grep 注入的每个服务名。本插件在 8 秒拿不到服务时会给出明确的错误行，不会无限等。
- 每个模块的注册各套 `guard()`：失败记 `console.warn`，不拖垮同文件其它模块。
- 官方 CSS-module 类名是「哈希_原名」结构，锚定一律用**属性前缀**（`[class*="tableScroll"]`、`[class*="widthHandle"]`、`[class*="composerSeat"]`），绝不硬编码 hash——官方 hash 版本间会变。
- **0.2.0-rc.1 已把 0.1.x 的 `data-dsh-part` 标记全部移除**（滚动条/调宽条/输入框的选择器都因此改过一轮）；`[data-slot="..."]` 是渲染器统一输出的，锚插槽容器用它。
- 浮层挂在 Shadow DOM 里时 `position: fixed` 会被困在深层的堆叠上下文，z-index 再高也没用——面板浮层挂在 body 的 shadow root 上规避。

## 更新检查（模块 3）

### 关键经验：注解必须回读，而且 pnpm 的 minimumReleaseAge 是主要的静止源

- **更新用 `name@latest` 的教训**：pnpm 11 的 `minimumReleaseAge`（profile 的 `pnpm-workspace.yaml`，本机 1440min=24h）会**静默**跳过发布不足 24h 的新版本——区级安装请求会成功、但它解析到「最新合法版本」而**不是**时候刚发布的版本，装上后版本没变，面板才改判「暂缓」。这不是失败，是 pnpm 的窗口保护，不报错。
- **绕法（已实测）**：把 spec 写成 **`name@精确版本号`**（`dsh-context@0.61.0` 而不是 `dsh-context@latest`），pnpm 会把该版本自动写入 workspace 的 `minimumReleaseAgeExclude`（实测输出 `Added 1 entry to minimumReleaseAgeExclude in pnpm-workspace.yaml`）并照常安装。所以本插件的 `startOne` 现在用面板解析出的 `latest` 拼 spec（`name + "@" + row.latest`），而不是 `name + "@latest"`。
- `finishOne` 的「版本没变 → 暂缓更新」判据仍然保留作为兜底（防 registry 解析与 pnpm 最终解析不一致），只是正常情况下它不会再被触发。
- 参考实现：社区分叉版 `@linxin666/dsh-client-ui-plugin-manager` 的 update handler 也是先 `fetchManifest` 拿 registry 的 `version`，再 `installBundle(name@version)`——即它「能更新」不是因为绕过了 pnpm，而是因为用的是精确版本。

### 本地包识别 = host 路由为主，404 签名兜底

- `listBundles()` 不透传安装来源（`installed` 不是 spec 字符串），而发布到 npm 的本地包（如 `@nimoxie/dsh-model-organizer`）连 registry 404 签名都不命中 —— 所以 host 半区挂了 `GET /api/ui-tweaks/local-plugins`（读 profile `package.json` 的 dependencies，按 source 分两类回给面板：**local** = `link:`/`file:` 本地路径，标「本地链接」；**remote** = `git:`/`github:`/`http` 直装，标「Git 直装」；仅回环放行）。两者都**不参与 registry 比对**——即使 npm 上有同名包（如 `dsh-ego-browser` 有 `github:` 声明、registry 也存在 0.8.6），装的也是仓库源码、与 npm 版不是一回事。client 每轮检查先取这份名单，取不到（host 半区未重启）再退回 404 签名（404 时也按 `installed` 来源区分 local/remote）。**改 host 半区必须重启 dsh/客户端才生效**（client bundle 刷新即可）。
  profile 目录定位：先从 `import.meta.url` 向上找带 `dsh.profile.bundles` 且包含自身的 package.json（npm 直装必命中）；软链安装时模块被解析到 profile 外的真实目录，退回 `DSH_HOME/profiles/*` 扫描，多 profile 命中时按 `ELECTRON_RUN_AS_NODE` 区分 desktop/web。

### 其它要点

- **更新主路径全部走官方 remote API**（host 半区只挂一条本地包识别路由）：`pluginManager.listBundles()`（清单+版本）、`installBundle("<名>@版本", { enabled, requestId })`（更新）、`waitForInstall(requestId)`（**仅**响应丢失后的恢复）、`cancelInstall(requestId)`（取消，回 `{status}`）。
- **`installBundle` 是「等到装完才返回」的调用，它的返回值就是终态**（0.1.4 的关键纠正）：remote 信封是 `{ok, value}`，`value` 即 `{changed, application, stage, target, enabled?, error?, warnings?, packageResult?, bundle?, pendingBuilds?, approvedBuilds?, registries?, failedAt?}`。官方桌面端插件页也是 `await installBundle(...)` 之后直接 `settleInstall(result.value)`。
- **`waitForInstall` 不是进度轮询器**（**0.1.3 的理解是错的，那正是「更新永远超时」的真因**）：它只用于**响应丢失后**恢复同一请求的结果，请求不在活动中时返回 `null`，而且**已完成的结果不保留**。`installBundle` 已经 await 到装完，此时再轮询 `waitForInstall` 必然一路读到 `null` → 空转到 240s 看门狗 → 面板报「更新超时」，真实结果（成功或 pnpm 报错）全被丢掉。0.1.4 起：正常路径只读 `res.value`；**仅当信封本身失败（`res.ok === false`，结果未知）**才调一次 `waitForInstall` 恢复，仍为 `null` 就如实报「已发起·未确认」。
- **终态判定读 `application`**：`applied` / `restart-required`（都算成功，后者提示重启）→ 回读版本核对；`cancelled` → 该行退回「有新版本」（取消不是失败，仍可重试）；`failed` → 行标「更新失败」，并把 `error.code`（译成中文）+ `error.diagnostic` + `packageResult.kind/exitCode/output/logPath` + `pendingBuilds` + `failedAt` 一起写进行内 `why`；`overridden` → 提示被覆盖、可重试；未知值一律按「结果未知」处理，不硬判成功。
- **回读版本是唯一成功判据**：只有在 `listBundles()` 里读到该行版本、且**与安装前不同**时才判「已是最新」。回读**只用 `pluginManager.listBundles()`**——`pluginInventory` 只有 `list()` 没有 `listBundles`（踩过，会造成「回读版本失败」假阳性）；装完瞬间清单可能短暂不可用，重试 3 次（1.5s 间隔）。比对基准 `busyBefore` 在 `startOne` 抓取，**不受中途「重新检查」重建行的影响**。
- **registry 比对在浏览器直连**：`registry.npmjs.org` 带 CORS *（实测），逐包**串行** fetch `/latest`，不打并发。代价要知道：比对源是 npmjs，而安装走 pnpm 自己的 registry（本机 `.npmrc` 指向 npmmirror）——镜像尚未同步到的新版本会「面板说有、装时报 no-matching-version」（见「待办」）。
- **取消要分清对象**（0.1.4 修）：排队项点取消只把它自己摘出队列（`cancelQueued`）；在装项点取消才 `cancelInstall(requestId)`，且**保留队列**，等这次落定后 `done() → pump()` 接着装下一项。旧实现 `requestCancel` 里一句 `queue = []` 把整个队列清空，于是「等待更新」的项全部退回「有新版本」不再开始——这就是「取消一项后，等待的项不更新、反而变回有新版本」的真因。`cancelInstall` 的回值 `{status: cancelled|not-running|too-late}` 也要读：`too-late` 说明已进入应用阶段、取消不掉，得如实告诉用户。
- **重新检查必须回填在飞状态**（0.1.4 修）：`checkNow` 重建 `rows` 会把「更新中/等待更新」抹成「有新版本」，而 `busyName`/`queue` 仍在——此时点那一行会撞上 `enqueue` 的 `name === busyName` 保护而**静默无反应**（这就是「重新检查后无法更新」的真因），真正在装的那一项也失去取消入口。修法是重建行后立刻 `reconcileInstallStates()` 把 busy/queuing 盖回去，且这两种行不参与 registry 比对。
- **总看门狗（0.1.4 起只是兜底）**：正常路径一次 `installBundle` 就定案，不必再等 240s；看门狗只覆盖 fetchLatest（现场查 registry，fetch 无超时）这类异常分支，触发时报「结果未知」并 `cancelInstall`。
- **`enabled` 用清单里的真实状态**：`installBundle` 的 `enabled` 传 `!(row.enabled === false)`，保留用户手动禁用的选择（旧实现一律 `enabled: true`，会把禁用的插件重新启用）。
- **失败原因要可见**：`fail` / `unchanged` / `unconfirmed` / `error` 行在行下多渲染一行 `.why`——只放在 `title` 悬停提示里，等于 pnpm 的报错没显示。


## 动画修复（模块 4）

- **原理**：Windows「动画效果」关闭 → Chromium 报 `prefers-reduced-motion: reduce`，dsh 的 40 处（17 包）`@media (prefers-reduced-motion: reduce)` 规则关掉动画。页面内**删不掉媒体查询的求值**，但删得掉规则本身：dsh 的 CSS 全部经 `<style>` 标签注入（实测 0 处 adoptedStyleSheets），同源 sheet 的 `cssRules` 可遍历可 `deleteRule`——把 reduce 的整条递归删除，基础动画声明（非媒体内）立即生效。效果与 dsh-web-shell 的 CDP `Emulation.setEmulatedMedia` 等价，但**不需要调试端口，桌面端也能用**。
- **JS 门控**：chat 包 3 处 `matchMedia("(prefers-reduced-motion: reduce)")`（滚动平滑 vs 跳转）用 `window.matchMedia` 包装覆盖——在返回的 MediaQueryList 上 `defineProperty("matches")` 影子化，按 no-preference 应答。包装必须在应用渲染前（apply 在合成期，早于 mount）。
- **晚到样式**：分包懒加载/换肤重写会在加载后重建样式，靠 `MutationObserver(head)` 防抖重扫 + 2s 轮询兜底（纯 CSSOM 枚举，无布局开销）。
- **取舍**：与 dsh-web-shell 的 `forceAnimations` 相同——覆盖系统无障碍设置。窗口级覆盖（启动器）换成会话级覆盖（插件），想恢复系统行为就得停用本插件；将来要做成可开关就着 dsh-model-organizer 的设置卡方案。
- web 窗口里本模块与 dsh-web-shell 的 CDP 覆盖并存是**无害冗余**（都指向 no-preference）。

## 从 dsh-web-shell 迁移的功能

对话区左侧滚动条与宽表格修复原是 dsh-web-shell 的 CDP 注入脚本，已整体迁入本插件（client bundle 自由 JS），dsh-web-shell 自身删除了对应代码与 `leftScrollbar` / `tableWidthFix` 配置。此处不重复实现细节（`lib/client.js` 各模块注释里保留：宿主挂 body 的理由、composerSeat 裁剪 −4px、拖动三层防御、零位移 wheel 事件解阅读锚点、出血布局三件套），只记两条迁移后才知道的知识：

- **「检查更新」按安装来源分流**：dsh-web-shell 时代来源由 PowerShell 读 profile 依赖判定；迁入插件后走 host 路由（见「更新检查」）。
- **判断 dsh 是否已修宽表格**（决定何时删掉模块 1）：打开含 ≥4 列表格的会话，控制台执行 `getComputedStyle(document.querySelector('[class*="tableScroll"]')).maxWidth`——若不再是 `100%`（或包裹层不再越界）说明官方已修，删除 `installTableWidthFix` 的 guard 行即完全回滚。

## 待办 / 路线

- [ ] 入口按钮支持 `sidebar.footer.action` 常驻入口（社区同款用此座位），当前只在插件管理页顶栏。
- [ ] 有更新时按钮加角标（现在要点开面板才看得到）。
- [ ] i18n（`ctx.locale.register(NS, {zh, en})`，照 dsh-model-organizer 写法）。
- [ ] 会话内重启 dsh 的入口（需要 host 配合或官方重启 API，未调研）。
- [x] 0.1.3：`waitForInstall` 终态按 zod schema 收紧了字段名（`application`/`stage`/`failedAt`）+ 全程总看门狗。**注意：这一版的结论是错的**——字段名猜对了，但把 `waitForInstall` 当进度轮询器用，而它只做「响应丢失恢复」；见 0.1.4 条目。
- [x] 0.1.4：终态改读 `installBundle().value`（`waitForInstall` 只在信封失败时兜一次）；取消不再清空队列、排队项可单独取消；`checkNow` 回填 busy/queuing；失败原因（`error`/`packageResult`/`pendingBuilds`）落到面板；`enabled` 沿用清单里的真实状态。
- [ ] 比对 registry 与安装 registry 对齐：面板查 `registry.npmjs.org`，pnpm 走 `.npmrc`（npmmirror）。镜像未同步的新版本会造成「面板说有新版、装时报 no-matching-version」。可用 `pluginManager.registries()` 取实际 registry 再比对（需先确认镜像的 CORS）。
- [ ] `pendingBuilds` 的「允许这些脚本并重试」入口（`installBundle(spec, { approvedBuilds })`）。现在只在失败行里列出待授权名单。
- [ ] `removable === false` / `optional` / 带 `readOnlyReason` 的 bundle 在面板隐藏或标注——否则点了会以 `management-required` 失败。
- [ ] `installBundle` 的 `registry` 参数补齐（官方传了，本插件省略）。
- [ ] 插件被禁用/卸载时的运行时清理（目前 DOM 残留到页面刷新为止）。

## 发布

- npm 不允许覆盖已发布的版本号：**先升版本，再提交，最后发布**。
- 版本号同时在 `package.json` 和 `lib/client.js` 的 `BUILD` 常量里（改两处）。发版命令：
  ```sh
  npm version patch        # 或手改 package.json 的 version；记得同步 BUILD
  git add -A && git commit -m "..." && git push
  npm publish
  ```
- **Token**：npm 2025-11 起只支持 granular token，发布需要有 **Bypass 2FA** 的权限：npmjs.com → 头像 → Access Tokens → Generate New Token → Packages 选 **All Packages + Read and Write (publish and stage)**、Organizations 选 **No access**、勾 **Bypass two-factor authentication**；然后 `npm config set //registry.npmjs.org/:_authToken=npm_xxx`（写进用户级 `.npmrc`，不要放进仓库——`.gitignore` 已排除 `.npmrc` 与 `*.tgz`）。
- 包是 scoped（`@nimoxie/dsh-ui-tweaks`），`publishConfig.access: "public"` 已写在 package.json，`npm publish` 不需要额外参数。
