# 开发笔记

面向改这个插件的人。用户文档在 [README.md](./README.md)。

**导读**：维护者笔记；每条「坑」都给成因与对策。
- **骨架 / 本地开发**：文件构成、四处须同步的标识、`file:` vs `link:`、装卸与刷新。
- **已知坑**：注入、类名、data 标记、Shadow DOM 浮层。
- **更新检查（模块 3）**：成熟期门禁与豁免表、cooling、强制更新、兼容门禁、Auto review。
- **动画修复（模块 4）**：删 `prefers-reduced-motion` 规则 + `matchMedia` 门控。
- **回合改动补位卡（模块 5）**：用会话日志里的 `meta.diffs` 重建回合尾卡、探测式补位、`tool/ptc-dispatch` 的 turn 归属。
- **窗口记忆（模块 6，仅 host 半区）**：helper + 预编译 DLL、宿主识别、编码坑、360 误报。
- **立即重启（模块 7）**：三模式判定、会话运行态、蒙皮、弹窗定位。
- **其余**：键盘与焦点、界面验证手法、迁移、待办、发布。

## 骨架（与 dsh-model-organizer 同构）

- `lib/index.js`：host 半区五条回环路由：`GET /api/ui-tweaks/local-plugins`（本地来源/DSH 版本，含 `dsh` 字段）、`POST /api/ui-tweaks/normalize-excludes`（豁免表归并）、`POST precheck-exempt` / `POST force-exempt`（预检/写豁免）、`GET|POST /api/ui-tweaks/restart`（立即重启）；加载时静默归并一次。
- `lib/client.js`：浏览器半区，`module.exports = { name, apply, inject }`；`apply(ctx)` 由客户端 cordis 调用。
- `cordis.patch.yml`：`- insert: [{id: ui-tweaks, name: '@nimoxie/dsh-ui-tweaks'}]`。**profile 必须声明 `dsh.bundle.patch`，否则启动报 declares no dsh.bundle**；**`insert.name` 必须写全 scope**。
- `package.json`：`exports["./client"]` 指 client bundle；`dsh.client.platform: "web"`；inject 只需 `@deepseek-ai/dsh-api-remotes`（提供 `remote.*`）；`react`/`react-dom` 是 shell 内置（PLATFORM_MODULES）。
- loader `id` 与 `exports.name` 只是内部标识；要同步四处：package.json、cordis.patch.yml、两个 profile 的依赖键 + `dsh.profile.bundles`、桌面 profile 的 lockfile 与软链。

## 本地开发

- **`file:` 是打包快照，`link:` 才是符号链接**：`file:` 时 pnpm 把目录复制进 store，改仓库不生效。
- 安装/重装：
  ```sh
  dsh plugin --profile web remove @nimoxie/dsh-ui-tweaks
  dsh plugin --profile web add "link:<本仓库绝对路径>"
  ```
- 改完 client.js 要 **Ctrl+Shift+R**（bundle 带 `Cache-Control: immutable` 且 URL 不随代码变化，普通刷新吃缓存）；装卸插件要**重启 dsh web**。
- **桌面 profile 由 Electron 独占管理**：npm 版 CLI 装/卸被拒（`managed exclusively by the Electron application`）；**客户端自带的 CLI 可以（0.1.8 修订）**：`<客户端安装目录>/resources/runtime/cli/bin/dsh.cmd` 经 `dsh-desktop-host/lib/cli.js` 以 `manageDesktopProfile: true` 调 `runCli`，故 `dsh plugin --profile desktop add|remove <包>` 与「插件管理」页同实现，连装 5 个插件成功。三条路：① 自带 CLI；② 插件管理页填 `link:<路径>`；③ 手改四件套（package.json + `dsh.profile.bundles`、pnpm-lock importers、node_modules 软链）。

## 已知坑

- **`ctx.inject([...])` 有一个服务名不存在，回调就永不执行且不报错**：升级 dsh 后功能静默消失，先去新版 `dsh-client-ui-*` 包 grep 注入的每个服务名。本插件 8 秒拿不到服务会给明确错误行。
- 每个模块的注册各套 `guard()`：失败记 `console.warn`，不拖垮同文件其它模块。
- 官方 CSS-module 类名是「哈希_原名」，锚定一律用**属性前缀**（`[class*="tableScroll"]`、`[class*="widthHandle"]`、`[class*="composerSeat"]`），绝不硬编码 hash——版本间会变。
- **0.2.0-rc.1 已移除 0.1.x 的 `data-dsh-part` 标记**（滚动条/调宽条/输入框选择器都改过）；`[data-slot="..."]` 是渲染器统一输出的，锚插槽容器用它。
- Shadow DOM 里的浮层，`position: fixed` 会被困在深层堆叠上下文，z-index 再高也没用——面板浮层挂 body 的 shadow root 规避。

## 更新检查（模块 3）

### 关键经验：pnpm 的 minimumReleaseAge 是主要的静止源（0.1.5 起分成两条路径看）

- **`minimumReleaseAge` 有两条独立作用路径**（0.1.4 只写对一半）：
  1. **门禁（解析之前）**：`pnpm install/add` 先校验**磁盘上现有的** lockfile，任一 entry 发布时间在窗口内 → **整体中止整个 profile 的安装**，报 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`（exit 1）；**写精确版本号也救不了**。
  2. **解析（门禁之后）**：候选不合法时 pnpm 挑「最新合法版本」（版本没变 → 面板判「暂缓」）；**显式写 `name@版本`** 时打印 `Added 1 entry to minimumReleaseAgeExclude in pnpm-workspace.yaml` 并照常安装——只绕开 ②。
- **豁免表的坑**：`minimumReleaseAgeExclude` 同包名**多条**时只有**靠前那条生效**（非并集：`[pkg@0.69.0, pkg@0.61.0]` 通过、`[pkg@0.61.0, pkg@0.69.0]` 失败）。陈旧条目**静默遮蔽**新条目，成功的未成熟安装又把新条目**追加在末尾**让旧条重新靠前 → 下次安装立刻失败。**成因：0.1.5 前「更新某插件 → 报一长串 pnpm 错误 → 之后所有插件都装不上」。**
- **对策（0.1.5）**：host 半区新增归并器 `normalizeReleaseAgeExcludes()`（`lib/index.js`），收敛成「每包一条」：同包多条只留「与 lockfile 锁定版本一致」的那条（否则留靠前那条）；受管包名（profile `dependencies`）唯一条且版本 ≠ 锁定版本 → 删除；非受管不重复的不动。结果恒为原条目的**子集**。触发：加载时 + `POST /api/ui-tweaks/normalize-excludes`（安装成功后/「重新检查」时 fire-and-forget）。约束：只改该段、写前留 `pnpm-workspace.yaml.bak-<时间戳>`、临时文件 + `renameSync` 原子替换、写后重读校验、无变化不写盘、幂等、异常不外抛。
  - **0.1.6 收尾**：解析与强制豁免**共用** `excludeBlockOf`（两份复制代码会让两个写者对「块从哪到哪」失配、再造遮蔽条）；备份/原子替换收敛到 `atomicWriteWorkspace`、只留最近 3 份 `.bak`；补 14 条回归测试（`dirOverride` 指向临时目录）：重复折叠/陈旧剪除/裸名豁免/非受管不动/块外字节不变/无变化不写盘/无键/无 lockfile/`.bak` 上限。
- **成熟期硬闸（0.1.6，装前校验）**：预判还在飞时那行仍可点「有新版本」，点下去 `startOne` 用精确版本 spec，而精确版本会被 pnpm 自动写进豁免表并照常安装 → **未成熟版本被静默装进去、没有确认**。现在 `startOne` 在 `installBundle` 前调 `guardMaturity(名字, 目标版本, 放行回调)`：未成熟且非强制 → 不装，落回 cooling（回填成熟时刻 + 技术细节 + 排自动重查）并清空 busy；强制流程写 `forcedNames[name]`（一次性凭据，用后即删、`done()` 终态也清）。判定表（10/10）：未成熟且非强制＝拦；有凭据＝放行并消费；已成熟、registry 无发布时间、packument 失败、目标版本未知（`@latest`）＝放行——后四条**刻意**：数据源不可用不该挡正常更新。
- **客户端「冷静期中」(cooling)**：① 预判：拉该包**全量 packument** 读 `time[版本]`（`/<pkg>/latest` 与 abbreviated packument 都**没有** `time`），`发布时间 + 窗口 > 现在` 即标 cooling；② 反应式：门禁报错里同时有 `published at <ISO>` 与 `cutoff <ISO>`，于是 `窗口 = now − cutoff`、`成熟时刻 = 发布 + 窗口`。反推窗口只接受 (0, 30 天]，越界退回会话默认值。cooling 标签**不可点安装**；`enqueue` 第二道闸只有 `force` 能过，装前还有第三道闸。
- **强制更新（0.1.6，跳过冷静期）**：真机复现（自带 pnpm 11.7.0，客户端 Electron 以 `ELECTRON_RUN_AS_NODE=1` 跑 `pnpm.cjs`，隔离临时工程，样本＝发布 4 小时的 `undici@8.12.1`）：
  1. **精确版本 spec 装未成熟版本 → 成功**：pnpm 打印 `Added 1 entry to minimumReleaseAgeExclude in pnpm-workspace.yaml` 并自行写豁免表 → 0.1.5 的「写精确版本也救不了」只对**无污染 lockfile** 成立。
  2. **豁免表为空 + lockfile 含未成熟条目**：跑 `install`（无事可做）→ 开头校验、整体失败、**磁盘零改动**；**若安装有活要干，安装照常落地、门禁在结尾才报 exit 1**（T2b/T3c）→ 必须**先预检、拒绝在动手之前**；「先试一下看报什么错」会把 profile 留在「装上了但命令报错」的混乱态。
  3. **遮蔽语义确认**：`[陈旧条, 未成熟条]` 失败、`[未成熟条, 陈旧条]` 通过 → 写入必须把目标版本放**块内第一条**。
  - 实现：host 两条回环路由 `POST /api/ui-tweaks/precheck-exempt`（只读预检）与 `POST /api/ui-tweaks/force-exempt`；`forceExemptVersion` 只动豁免段落（目标插块首、其余字节逐字节保留、备份＋renameSync＋写后重读校验；**有意突破**归并器「结果恒为子集」）；`precheckExempt` 只扫 **profile 直连依赖**（lockfile importers）＋发布时刻 10 分钟缓存，列出「未生效豁免且仍在窗口内」的包（传递依赖不扫，漏判靠安装失败时的反应式报错兜底）。客户端三段式：入口 → 预检 → 拦路者清单/二次确认 → 写豁免 → 安装；`enqueue(name, { force: true })` 是唯一放行冷却行的入口。
  - 验证：host 隔离 15/15（写入位置、字节保留、去重、预检筛选、目标跳过）；UI 渲染 9/9；真机路由 `precheck-exempt` 返回 `{ok:true,blocked:[]}`，`local-plugins` 正常。
- **cooling 文案（0.1.6 定稿）**：列表默认只有**一句话**——`0.70.0 还需等待 10 小时 40 分才能更新（10-15 07:54 到期，点标签看详情）`。完整解释走 `coolingReasonText(detail, windowMs)`，**只在点「冷静期中」标签展开时渲染**（`.dtl`）：为什么等（dsh 的 24 小时策略讲成人话）→ 硬装的后果（连坐整个 profile，故不提供直接安装）→ 到点自动恢复 → 末尾附原始诊断（预检＝registry 记录，反应式＝pnpm 报错）。等待期已过 / 结束时间未知各有文案。换行由 `.why` 的 `white-space:pre-wrap` 呈现。
- **到期自动重查（0.1.6）**：`scheduleCoolingRefresh(name, matureAt)` 给 cooling 行排到点（+3s 缓冲）的 `checkOne(name)` 定时器（按包名去重）；触发点＝`applyCoolingGuess` 落 cooling 后、`judge` 冷却分支落 cooling 后；上限（约 24.8 天）之外不排。
- **兼容门禁（0.1.7，借鉴 plugin-manager）**：新版 registry 清单可能声明最低 DSH 版本（`dsh.engines.dsh` → 顶层 `engines.dsh` → `peerDependencies["@deepseek-ai/dsh"]`）；本机版本由 host 半区读 `profileContext.installAnchor` 的清单，兜底读 profile 里的 `@deepseek-ai/dsh`。低于要求 → 标 **「DSH 不符」**、不给点、不计入「全部更新」。**只认 `>=x.y.z`**；未声明、写法不认识（`^`/`~`）、读不到版本 → 一律不拦。
- **「Auto review」提醒条（0.1.7，只读不改）**：DSH 0.2.0-rc.2 的已知缺陷 —— `auto` 模式的会话会让 `permissionPresets` 在热重载（装/更新插件就会触发）时构造失败（`pinInitialPermission` 构造期遍历已驻留会话，`autoAdmit` 还没注册就抛错），表现为装插件报一长串错、连带 `sessionProjections` 也起不来，要重启客户端才恢复。面板顶部加琥珀色提醒，**只读检测**「是否有驻留会话的 permissions 投影 currentValue === 'auto'」（读法同官方权限面板：`ctx.get('sessions')` → `list.getSnapshot().ids` → `binding(id).session.projections.faceOf('permissions').getSnapshot()`）；**不写设置、不拦操作**。
  - **0.2.1-rc.2 复核（2026-10-18）**：预设标识仍是 `AUTO_PRESET = "auto"`，界面文案改叫「自动审查」，判定串 `currentValue === 'auto'` **不受影响**；旧缺陷的 throw 仍在，但 auto-review 集成新增卸载时的收尾迁移（先把所有 auto 会话改成 `danger-full-access` 再退出），触发窗口收窄、日志无该错误痕迹。该模式还有**调用前审查**：服务不可用或限流时工具调用**直接被拒、工具体不执行**（`503` 与 `429 请求过于频繁（limit 30）`）。
- **本机环境**：dsh 用**自带的 pnpm 11.7.0**，**不是** PATH 上那个（PATH 是 11.21.0）；排查必须用前者复现，否则结论会反过来。自带运行时在 **`<客户端安装目录>/resources/runtime/`**：`pnpm/`（11.7.0 包）、`bin/node`（shim，exec `$DSH_DESKTOP_NODE_EXECUTABLE`＝客户端 Electron + `ELECTRON_RUN_AS_NODE=1`）、`versions.json`（node 24.18.1 / pnpm 11.7.0）。复现：`ELECTRON_RUN_AS_NODE=1 npm_config_minimum_release_age=1440 "<客户端>/DeepSeek Harness.exe" --expose-internals "<客户端>/resources/runtime/pnpm/bin/pnpm.cjs" add <pkg>@<ver> --registry=https://registry.npmjs.org/`。
- 参考实现：社区分叉版 `@linxin666/dsh-client-ui-plugin-manager` 同样先 `fetchManifest` 再 `installBundle(name@version)`——它「能更新」不是绕过门禁，而是用了精确版本。

### 本地包识别 = host 路由为主，404 签名兜底

- `listBundles()` 不透传安装来源（`installed` 不是 spec 字符串），发布到 npm 的本地包（如 `@nimoxie/dsh-model-organizer`）连 registry 404 签名都不命中 —— 故 host 半区挂 `GET /api/ui-tweaks/local-plugins`（读 profile `package.json` 的 dependencies：**local** = `link:`/`file:` 标「本地链接」，**remote** = `git:`/`github:`/`http` 标「Git 直装」；仅回环放行）；0.1.5 起还有 `POST /api/ui-tweaks/normalize-excludes`。两者都**不参与 registry 比对**（如 `dsh-ego-browser` 有 `github:` 声明、registry 也有 0.8.6，装的仍是仓库源码）。client 每轮先取名单，取不到（host 未重启）再退回 404 签名。**改 host 半区必须重启 dsh/客户端**。
- profile 目录定位：从 `import.meta.url` 向上找带 `dsh.profile.bundles` 且包含自身的 package.json（npm 直装必命中）；软链安装时模块解析到 profile 外，退回 `DSH_HOME/profiles/*` 扫描，多 profile 命中按 `ELECTRON_RUN_AS_NODE` 区分 desktop/web。

### 其它要点

- **更新主路径全部走官方 remote API**：`pluginManager.listBundles()`、`installBundle("<名>@版本", { enabled, requestId })`（更新）、`waitForInstall(requestId)`（仅响应丢失恢复）、`cancelInstall(requestId)`（取消，回 `{status}`）。
- **`installBundle` 等装完才返回，返回值即终态**（0.1.4 纠正）：信封 `{ok, value}`，`value` 含 `{changed, application, stage, target, enabled?, error?, warnings?, packageResult?, bundle?, pendingBuilds?, approvedBuilds?, registries?, failedAt?}`；官方插件页同样 `await installBundle(...)` 后 `settleInstall(result.value)`。
- **`waitForInstall` 不是进度轮询器**（0.1.3 的理解是错的，正是「更新永远超时」的成因）：它只在**响应丢失后**恢复同一请求，请求不在活动中返回 `null` 且**已完成结果不保留**。装完再轮询只会空转到 240s 看门狗、丢掉真实结果。0.1.4 起只读 `res.value`，仅信封失败（`res.ok === false`）才恢复一次，仍 `null` 就报「未能确认」。
- **终态判定读 `application`**：`applied` / `restart-required`（都算成功，后者提示重启）→ 回读版本；`cancelled` → 退回「有新版本」；`failed` → 标「更新失败」，把 `error.code`（译中文）+ `error.diagnostic` + `packageResult.kind/exitCode/output/logPath` + `pendingBuilds` + `failedAt` 写进行内 `why`（带 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` 时判 `cooling`，反推窗口记进会话复用）；`overridden` → 可重试；未知值按「结果未知」。
- **回读版本是唯一成功判据**：`listBundles()` 里读到该行版本且**与安装前不同**才判「已是最新」。只用 `pluginManager.listBundles()`（`pluginInventory` 只有 `list()` 没有 `listBundles`，会造成假阳性）；清单短暂不可用时重试 3 次（1.5s）。基准 `busyBefore` 在 `startOne` 抓取。
- **registry 比对在浏览器直连**：`registry.npmjs.org` 带 CORS *，逐包**串行** fetch `/latest`。代价：安装走 `.npmrc` 的 npmmirror，镜像未同步的新版本会「面板说有、装时报 no-matching-version」。
- **取消要分清对象**（0.1.4 修）：排队项取消只摘出自己（`cancelQueued`）；在装项取消才 `cancelInstall(requestId)`，且**保留队列**，落定后 `done() → pump()`。旧实现 `requestCancel` 一句 `queue = []` 清空全队列，导致「等待更新」的项全退回「有新版本」——这是「取消一项后其余项不更新」的成因。回值 `{status: cancelled|not-running|too-late}`。
- **重新检查必须回填在飞状态**（0.1.4 修）：`checkNow` 重建 `rows` 会把「更新中/等待更新」抹成「有新版本」而 `busyName`/`queue` 还在，点那行撞上 `enqueue` 的 `name === busyName` 保护而**静默无反应**（「重新检查后无法更新」的成因）。修法：重建后立刻 `reconcileInstallStates()` 盖回 busy/queuing，这两种行不参与比对。
- **总看门狗只是兜底**（0.1.4 起）：正常路径一次 `installBundle` 定案，不必等 240s；只覆盖 fetchLatest（fetch 无超时）这类异常分支。
- **`enabled` 用清单真实状态**：传 `!(row.enabled === false)`，保留用户手动禁用（旧实现一律 `enabled: true`，会重新启用）。
- **失败原因要可见**：`fail`/`unchanged`/`unconfirmed`/`error`/`cooling` 行下多渲染 `.why`（只放 `title` 悬停等于没显示）。0.1.5 起先 `stripAnsi`（CSI/OSC/控制字符/CRLF，否则首屏是 `鈺?` 残渣），`diagnostic` 与 `packageResult.output` 互相包含只留更完整的一份。

## 动画修复（模块 4）

- **原理**：Windows「动画效果」关闭 → Chromium 报 `prefers-reduced-motion: reduce`，dsh 的 40 处（17 包）`@media (prefers-reduced-motion: reduce)` 规则关掉动画。媒体查询的求值删不掉，但规则删得掉：dsh 的 CSS 全经 `<style>` 注入（0 处 adoptedStyleSheets），同源 sheet 的 `cssRules` 可遍历可 `deleteRule`——递归删掉 reduce 规则，基础动画立即生效。与 dsh-web-shell 的 CDP `Emulation.setEmulatedMedia` 等价。
- **JS 门控**：chat 包 3 处 `matchMedia("(prefers-reduced-motion: reduce)")` 用包装 `window.matchMedia` 覆盖——对返回的 MediaQueryList `defineProperty("matches")` 影子化，按 no-preference 应答；必须在渲染前（apply 早于 mount）。
- **晚到样式**：懒加载/换肤会重建样式，靠 `MutationObserver(head)` 防抖重扫 + 2s 轮询兜底（纯 CSSOM）。
- **取舍**：同 dsh-web-shell 的 `forceAnimations`——覆盖系统无障碍设置，要恢复就得停用本插件；与 dsh-web-shell 的 CDP 覆盖并存无害。

## 回合改动补位卡（模块 5，0.2.0 起）

- **问题**：官方回合尾卡的数据源是 `workspaceChanges` 服务 —— 摘要与对比只在**内存 + 系统临时目录**里（契约原文：serves … **while its Session lives**），Session 一释放（切走会话、重启客户端、重开旧会话）接口就 404，卡片退化成一句「这轮改动的内容已不可用」。
- **官方其实有持久的那一份**：文件工具（`dsh-tool-fs` / `dsh-tool-str-replace-editor`）每次改动都把 `meta.diffs: [{path, oldText, newText}]`（**前后全文**）写进工具结果事件，随会话日志永久保存；客户端画工具卡 diff 用的就是它（`dsh-client-ui-tool` 的 `appliedDiffs`，hunks 由 `dsh-web-frontend` 在浏览器里用 `oldText/newText` 现算）。**所以本模块不新增任何持久化**，只是把同一份数据按回合再聚合一次。
- **官方先例**：`dsh-client-ui-schedule` 注释原文 —— narrowed from the persisted result JSON, so Session-log replay reproduces the card with **no Host change** and no presentation metadata。
- **API 形状**（0.2.1-rc.2 实测）：
  - `ctx.uiConversation.events.register({ kind, match, start, update })`：`match(event) → {id, role:"start"|"update"}`，`id` 只是分组键（官方用 `String(turn)`）；`update(context, match)` 第一个参数带 `.state`，**`match.event` 才是事件**（把 match 当事件读会全空）；返回值经 `requireState` 校验，**不能 undefined**。
  - 槽位：`ctx.slots.register({ name:"conversation.chat.turnTail", id, order, inject }, Component)` —— 契约 `kind:"list"`，现有 deliverables / plan(order 20) / schedule 三家，我们取 **order 30**。
  - 卡片 props：`{ turn, seq, openFile, sessionId, t, …hooks }`；**Definition 的状态用 `props.turn.data.get(kind)` 读**（deliverables 的 `changesForClosing` 就是这么取）。
- **嵌套调用的 turn 归属**：`tool/ptc-dispatch`（run_code 里的 edit/write）**没有 turn 字段**（只有 `rootCallId/parentCallId/subCallId` + `meta.diffs`），用 `tool/call`（有 `turn`/`callId`）建 `rootCallId → turn` 映射挂回去。前端**收得到** ptc 事件（`dsh-client-ui-chat`/`tool`/`plan` 都在匹配它），否则本模块会漏掉绝大多数改动。
- **探测式补位**：`GET api/changes.summary?sessionId=…&seq=<workspace/changes 的 seq>`（**文档相对**，无前导斜杠；官方 `changesSummaryUrl` 同形）。**200 → 不画**（让位官方卡）；**只有 404 才画**；401/其它状态/网络异常一律不画 —— 宁可漏补，不可误补出双份。
- **缓存策略**：探测结果只缓存在**本次连接**内，`connection/reset` 清空。官方自己永久缓存 missing（`{failed:"missing", retryable:()=>false}`），那会在宿主恢复或探测期误判后留下双份卡且**无法自愈**。
- **同文件多次改动**：按 old→new 链折成一份净变化（后段 `oldText` 应等于前段 `newText`）；链断则分段显示并分别计数，不报错。
- **边界**：只覆盖文件工具；pwsh / npm 等造成的改动进不来（只有官方卡含）。已释放的旧会话**不需要回填** —— 日志在磁盘上就能立刻重建（这是选 A 而非自己持久化的最大理由）。
- **验证**：离线 harness（`%TEMP%\dshuiw-changes-test\test-changes.cjs`，vm + React/DOM 桩）**31/31** —— Definition 聚合与 turn 归属、链式合并、折叠/展开渲染与计数、200 让位、401 不画、fetch 抛异常不崩、链断降级、服务缺失只 warn 不拖垮其它模块、React 缺失不注册槽位。**真机待验证**。

## 窗口记忆（模块 6，仅 host 半区）

官方桌面客户端主窗口写死 1280×820 居中、主进程无窗口状态持久化（app.asar 里 `createWindow` 无 placement）；渲染层 `contextIsolation+sandbox`、`dshDesktop` 桥只给 `dsh-app://app` 主框架。故走**进程外**：host 半区 spawn 隐藏 PowerShell helper（`lib/window-helper.ps1`），Win32 互操作来自 `lib/window-helper.cs` 预编译的 `window-helper.dll`（装到 profile 的 `ui-tweaks/`）。

- **不用独立 exe（别走回头路）**：csc 编译的 winexe 版被安全软件反复弹「无法验证发布者」并被静默拦截（进程秒退、无日志）；改成 **DLL 由 PowerShell 进程内加载**：零提示。且 DLL 必须 `Assembly.Load(byte[])` 字节流加载——profile 在云盘/虚拟盘上时 `Add-Type -Path`/`LoadFrom` 会报 `0x80131515`。
- **找宿主进程**：进程树是 `主进程 -> --expose-internals -> spawn-bridge -> dsh 运行时`，**四层全叫 `DeepSeek Harness.exe`**。故不能从运行时自己开始匹配（会把自己当宿主），也不能取第一个同名祖先（无窗口的中间层）——必须**沿父链走到最后一个同名进程**（树根＝主进程）。走链用 ntdll `NtQueryInformationProcess` + .NET Process（无 WMI：冷启动 100ms~2s 延迟不能接受）。
- **恢复时机＝catch-up（物理极限）**：客户端先隐藏创建窗口再 show，**而本插件加载在 show 之后**（时间线：t+0 隐藏创建 → t+2.5 show → t+3.0 插件 apply → t+3.4 helper 首次轮询 → t+3.5 归位）。故「赶在 show 前归位」做不到；能压缩的只有自己的 0.2s。要零闪现只能常驻 watcher 进程（不属于运行时、跨重启存活、守下一次启动的隐藏窗口）——代价是常驻进程 + 卸载残留，未采纳。
- **归位用「隐藏→移动→显示」三明治**：直接 `SetWindowPos` 会看到窗口先停在默认位置再滑走；改为 `SW_HIDE` → 移动 → 按原前台状态 `SW_SHOW`/`SW_SHOWNA`（`GetForegroundWindow` 判定，不抢焦点）。
- **最小化窗口必须能被跟踪（修过）**：`GetWindowRect` 对最小化窗口返回 `(-32000,-32000) 160x28`，用它做尺寸门槛会把窗口筛掉、helper 报「window gone」并**停止记录**——最小化一次就断线、状态停在旧值（「记忆没生效」的主要来源）。修法：尺寸改用 `GetWindowPlacement` 的 `rcNormalPosition`；最大化判定不能只看 `showCmd==3`（最大化后被最小化时 `showCmd==2` 但 `flags` 含 `WPF_RESTORETOMAXIMIZED(0x2)`，见 `[DshWin]::MaximizedState`）。
- **识别宿主窗口**：枚举宿主 PID 顶层窗口，过滤 `Chrome_WidgetWin_1` + `WS_THICKFRAME`（可缩放）+ ≥400×300 取最大者；欢迎窗（600×700）、更新弹窗因此天然排除，标题随页面变化不可靠。
- **最大化恢复**：`SetWindowPos` + 需要时 `ShowWindow(SW_MAXIMIZE)`；`rcNormalPosition` 两种状态通吃，取消最大化不会错位。
- **保存**：1s 一拍 `GetWindowPlacement`，`showCmd==3` 判最大化；按「值签名」比对（不含时间戳，否则每秒落盘），变化才 `WriteAllText(tmp)` + `Move-Item -Force` 原子覆盖；恢复前用 `MonitorFromRect(MONITOR_DEFAULTTONULL)` 校验坐标仍在显示器上。
- **生命周期**：看门狗盯两个 PID（dsh 运行时、Electron 主进程）任一消失即退出；单实例锁文件（`window-helper.lock` 存 PID，新 helper 杀旧的）；helper 随运行时进程树一起死。
- **⚠️ 编码坑（两个 helper 文件必须纯 ASCII）**：生成的 .ps1 必须带 **UTF-8 BOM**（`lib/index.js` 已加 `\ufeff`）。PS 5.1 对无 BOM 脚本按 ANSI/GBK 解析，中文注释的 UTF-8 字节流会错误配对、**吞掉换行把下一行代码并进注释**——症状是赋值静默不执行/here-string 错乱、无报错。
  - 新变种：`window-helper.ps1` 的中文注释导致 `$cmd = [uint32]0` 被并进注释——生产没事（index.js 写入带 BOM），但**仓库副本直接跑**读无 BOM 文件 → `[ref]$cmd` 报「无法将 [ref] 应用于不存在的变量」。故规则升级：**两个 helper 文件都保持纯 ASCII**（csc 对无 BOM 源码也按 ANSI 读），两文件头都写着 keep pure ASCII。
- **语义补丁**：Windows 对**最大化窗口忽略 `SetWindowPos`**（位置归显示器所有），故「存的窗口化、当前最大化」时归位静默失效——catch-up 先 `SW_RESTORE`（`[DshWin]::Restore`，窗口本来可见、安全）再隐藏/移动，再按状态决定是否 `SW_MAXIMIZE`。启动路径不受影响。
- 文件落点：`<desktop profile>/ui-tweaks/{window-helper.cs, window-helper.dll, window-helper.ps1, window-helper.lock, window-state.json, window-helper.log}`（日志超 96KB 截尾）；删 `window-state.json` = 重置记忆。
- **怎么测（0.1.6 起，已无测试钩子）**：`-TestPid` 旁路参数已删除，改走**真链路**——真实客户端当宿主、真实 dsh 运行时的 PID 当 `-DshPid`、只换临时状态文件，于是「沿父链走到最顶层同名进程」真被跑到；窗口收托盘也测得了，测完按 `SetWindowPlacement` 还原。副产品：**`Program`（C# 编排）早就不等价于 ps1**，0.1.6 整个删掉（−200 行），`window-helper.cs` 只剩 `DshWin` 互操作层。另：**把 msedge.exe 改名成 `DeepSeek Harness.exe` 当假宿主行不通**——SxS 清单写死程序名。

### 360 报「PowerShell 执行攻击命令」

误报，且**不要靠改启动参数去绕**：360 这条规则匹配的是「父进程创建 powershell.exe」这个动作本身，与命令行无关（复现时弹窗里连命令行都不显示）。dsh 官方桌面版每次启动自己也会创建 2 个隐藏 PowerShell（埋点环境采集）+ 1 个图标提取用，所以本插件怎么改都消不掉这个弹窗。helper 的参数按功能需要来定，不为此调整。

## 立即重启（模块 7，host 路由 + 独立弹窗）

- **为什么需要**：loader 只在启动时读清单，插件更新必须重启才生效；官方插件页没有此入口。
- **三段式**：`GET /api/ui-tweaks/restart` 只读「方案」（无副作用）→ 确认 → `POST` 才执行（先写 `202 {ok,mode}`，约 0.4s 后退出）。非回环 403、其它方法 405。
- **先问会话在不在跑**：点按钮并行读「重启方案」与 `sessions` 运行态（`ctx.get('sessions').list.getSnapshot().byId[*].running`，`refresh()` 后读快照，900ms 超时退回旧快照）。三种结果都落到同一确认面板、文案不同：N 个在跑 → 列前 5 个标题并说明会中断；0 个 → 不打断任务；问不到 → 保守说明。**永不自动执行**（旁边永远有「取消」；`manual` 不给重启按钮）。
- **三种模式**（`planRestart` 纯函数）：① 桌面客户端（`ELECTRON_RUN_AS_NODE=1` 或 `process.versions.electron`）→ `shell`：插件重启不了 Electron 进程树，只自己退出，由外壳弹「应用无法启动或已意外停止」对话框（在那里点「重启」才是 `app.relaunch()`）。② 终端里的 dsh（stdin/stdout 是 TTY）→ `relaunch`：`node -e <自包含助手>` detached 起助手，等旧进程消失（上限 30s）后按**原命令行**重拉，剔除 `--inspect*` / `--debug*`，新进程 3 秒内秒退最多重试 5 次，日志写 `$DSH_HOME/logs/ui-tweaks-restart.log`。③ 无 TTY/被监督 → `manual`。
- **绝不把用户丢在没有服务的状态**：`relaunch` 起不了助手就退化为 `manual`（进程留在原地），只有确认能重拉才安排退出。
- **文案按形态讲清「点下去会发生什么」**：桌面端说透两步（dsh 先退出 → 客户端弹官方对话框，在那里点「重启」才拉得起来），补「对话框会写崩溃报告；也可手动退出后重开」；`relaunch` 说「服务重拉、任务会中断」；`manual` 只说手动重启且**不给重启按钮**。
- **确认后的蒙皮**：点「重启 dsh」即整页蒙住（`.rscrim` 与弹窗同一阴影根，`z-index:2147483000`，弹窗 `…001` 在最上层；拦掉 `wheel`/`touchmove`）。只在「确认执行」期间存在：失败出口与 `manual` 退化出口都撤掉；`RST_KILL_WAIT_MS`（20s）兜底——页面还活着就撤蒙皮、落 `error` 并提示刷新/手动重启。**0.1.8 补两处**：`showScrim(true)` 把 `body` 其余子树整块 `inert`（跳过重启弹窗宿主；Chromium 102+）；捕获段拦掉 PageDown/PageUp/空格/方向键/Home/End 等纯滚动键。
- **确认之后的收尾**：`POST` 成功且模式是 `shell` / `relaunch` 时**停在「正在重启…」**、**不给按钮**（宿主 0.4s 后就退出，给「知道了」也点不到）。`done`（可点「知道了」）只在 `manual` 退化时出现。`POST` 回包中断则落 `error`，说明「连接中断通常意味着确实在重启，刷新看看」并给「重试」。
- **弹窗定位**：两面板共用 `placeNear(anchor, wrap, width, minHeight)`——贴触发按钮，**优先放下方**，放不下就翻上方；水平夹在视口内；可用空间写成 `max-height`。`resize`/`scroll` 经 rAF 合并后重排；**都不可拖动**（旧版更新面板的拖拽 + `panelPinned`/`panelDragging` + 本地存储坐标已移除——曾出现「拖过一次就再也不跟按钮、不跟滚动」）。
- **宽度/高度一律实测（0.1.8 修订）**：Shadow DOM 里吃不到官方 `box-sizing` 复位，`.rwrap` 是 content-box 带 `12px` padding → 真实外框比 `RST_WIDTH=330` 多 **26px**；`.wrap` 无 padding、只差 2px 边框，所以「检查更新」看着齐。`measuredBox()` 改用 `getBoundingClientRect().width`，拿不到才退回常量，并从 `maxHeight` 扣掉 `padding+border`。同批：`room` 不再 `Math.max(120, …)`；翻转判据改用 `scrollHeight`（`offsetHeight` 会被上次 `maxHeight` 夹住）；scroll 监听用 `composedPath()` 滤掉面板自身 `.rows`。
- **颜色语义**：「立即重启」按钮（红描边 + 主题 `label-danger`）与确认按钮都红——唯一会打断进行中任务的动作；橙色留给「强制更新」，绿色只给状态。
- **UI 与按钮位置**：重启有独立 Shadow DOM 弹窗（`dshuiw-restart-panel-host`），按按钮矩形定位；按钮挂到 `[data-plugin-panel] [data-plugin-group="bundles"]` 的第一个子元素（「已安装」标题行），`span#dshuiw-list-actions` 靠 `margin-left:auto` 靠右、样式自绘；React 重渲染会抹掉手插节点，MO + 轮询兜底。
- **测试**（隔离，`%TEMP%\dshuiw-restart-test\`）：host 16/16（四种方案判定、`manual`/助手失败不退出、`relaunch`/`shell` 恰在 400ms 后退出、5 条路由、非回环 403、PUT 405、GET 无副作用、POST 202）；client 51/51（兼容门禁判定表含等号边界与 `1.10.0 > 1.9.9`、会话运行态、弹窗各态、**任何会话数都不自动执行**、定位、**蒙皮开关与 20 秒兜底**、**Auto review 五种检测**）。0.1.8 追加：`wireKeyActivation` 5 组输入的 Node 断言；三处焦点环与 `KBD` 属性；`placeNear` 真实盒尺寸（346 / 356）复算，两弹窗右缘偏差 **0px**（改前 2px / 26px）。

## 键盘与焦点（0.1.8 起）

弹窗控件都是自绘 `<span>`（不是 `<button>`），可点性全靠 click 委托——键盘完全用不了：Tab 停不上去、回车/空格没反应，读屏也读不出「这是按钮」。原则是**只补语义与键盘，不动渲染结构与 CSS**：

- **`role="button" tabindex="0"`（`KBD` 常量）**加在每处可点元素：`.tag.clickable`、`.fbtn.*`、`.recheck`/`.allbtn`/`×`、`.rbtn.*`。
- **Enter/Space 走同一条委托**：`wireKeyActivation(wrap)` 接 keydown，只对 `role="button"` 生效，`preventDefault()`（Space 默认滚页面）后派发一次 `click()`——键盘与鼠标共用一套处理。
- **焦点环用官方令牌**：`app.asar` 有 237 条 `:focus-visible`，主题变量 `--dsw-focus-ring-width` / `--dsw-focus-ring-color`（回退 `--dsw-alias-state-business-primary`）；三处焦点环（两面板 shadow 样式 + **页面级两枚自绘按钮**）统一用它们。**页面级按钮最容易漏**——官方全局样式管不到 `createElement` 的按钮，这正是「Tab 上去没反应/没有焦点环」的成因。
- **焦点管理**：更新面板打开时焦点进面板（`.wrap` 带 `tabindex="-1"` + `role="dialog"`，非模态），`×`/Esc 收起后还给触发按钮（**点外部收起不还**）；重启弹窗是 `role="dialog" aria-modal="true"`，确认/失败/收尾态焦点交给主按钮。判据必须用 `shadowRoot.activeElement`——`document.activeElement` 在 shadow DOM 返回宿主，判不出「里面已有焦点」，会让每次重渲染都把焦点抢回主按钮。
- **面板显示权归「打开/收起」**：`paint()` 只重画内容，不再无条件 `wrap.hidden = false`——否则后台一有动静（装完包、冷静期重查、240s 兜底）就会把用户刚收起的面板弹回来；收起统一走 `closePanel(refocus)`。

## 界面/布局改动的验证手法（0.1.6 起）

面板是 Shadow DOM + 运行时拼字符串，肉眼看不出「差几个像素」，要**量出来**：

1. **抽真实 CSS**：求值 `lib/client.js` 里 `sr.innerHTML = "<style>" + …` 那整段，切出 `<style>`（挑含 `.wrap{position:fixed` 的那块）。
2. **复刻 markup**：用真实 CSS + 按 `paint()` 的结构手写 markup，`getBoundingClientRect()` 量间距，`fetch("/report")` POST 回本地 Node 服务。
3. **Edge 无头打开**：`msedge --headless=new --disable-gpu --user-data-dir=<每次唯一> http://127.0.0.1:<port>/`。两个坑：同一 user-data-dir 会「移交」给旧实例、页面不加载（必须每次唯一并清残留进程）；该 Edge 上 `--dump-dom` 不输出，得让页面自己 POST 回来。
4. `.why` 是 `white-space:pre-wrap`：美化换行/缩进会被当空白行渲染，HTML 必须紧凑拼接，否则数值全假（`dtl_border_to_text` 量出 42px、真实 6px）。

0.1.6 靠它抓到：遗留规则 `.fbtn{margin:8px 8px 0 0}` 与新增规则并存，让强制按钮比状态标签多 8px 右内缩（36 vs 28）；删掉后都是 13px、文字到按钮 8px（行盒 16px）。

## 从 dsh-web-shell 迁移的功能

对话区左侧滚动条与宽表格修复原是 dsh-web-shell 的 CDP 注入脚本，已整体迁入本插件（client bundle 自由 JS），dsh-web-shell 自身删了对应代码与 `leftScrollbar` / `tableWidthFix` 配置。细节见 `lib/client.js` 各模块注释（宿主挂 body、composerSeat 裁剪 −4px、拖动三层防御、零位移 wheel 解阅读锚点、出血布局三件套），只记一条：

- **判断 dsh 是否已修宽表格**（决定何时删模块 1）：打开含 ≥4 列表格的会话，控制台跑 `getComputedStyle(document.querySelector('[class*="tableScroll"]')).maxWidth`——不再是 `100%` 说明官方已修，删掉 `installTableWidthFix` 的 guard 行即完全回滚。

## 待办 / 路线

- [ ] 入口按钮支持 `sidebar.footer.action` 常驻入口（社区同款座位），当前只在插件管理页顶栏；有更新时加角标。
- [ ] i18n（`ctx.locale.register(NS, {zh, en})`，照 dsh-model-organizer）；会话内重启 dsh 的入口（需 host 配合或官方重启 API，未调研）。
- [x] 0.1.3：`waitForInstall` 终态字段名 + 总看门狗（**结论错**，见 0.1.4）。
- [x] 0.1.4：终态读 `installBundle().value`；取消不清队列、排队项可单独取消；`checkNow` 回填 busy/queuing；失败原因落面板；`enabled` 用清单真实状态。
- [x] 0.1.5：cooling + `normalizeReleaseAgeExcludes` 归并器 + `POST /api/ui-tweaks/normalize-excludes`；文案剥 ANSI、pnpm 输出去重。
- [x] 0.1.6：窗口记忆（DLL + helper）；「重启生效」条；cooling 一句话 + 详情 + 到期重查；强制更新（两条路由 + 三段式 + `enqueue(name,{force:true})`）；硬闸 `guardMaturity`（10/10）。
- [x] 0.1.7（2026-10-16，tag `v0.1.7`）：立即重启（模块 7）、兼容门禁（`DSH 不符`）、按钮迁到「已安装」标题行、脚注。
- [x] 0.1.8（2026-10-17 00:34，npm latest）：弹窗定位实测外框（26px）、`room` 下限、重排判据；面板显示权归还「打开/收起」；蒙皮补 `inert` 与键盘滚动锁；控件补 `role/tabindex` + `Enter/Space` + 焦点环；README 补自带 CLI 例外。tag `v0.1.8`（`8aed2bc`）。
- [x] 0.2.0（2026-10-18）：回合改动补位卡（模块 5）—— 用会话日志里的 `meta.diffs` 重建回合尾卡、探测式补位（只在官方 404 时画）、`tool/ptc-dispatch` 的 turn 归属、缓存随连接重置。离线 31/31；**真机待验证**（刷新客户端 → 跑一轮改文件的对话 → 切走再切回 / 重启后重开，看卡是否仍在且不重复）。
- [ ] `shell` 模式重启不留日志（`ui-tweaks-restart.log` 只有 `relaunch` 分支写），要硬证据就在 `performRestart` 退出前追加一行；「点按钮 → 宿主退出」目前只有 `crash-*-host.log` 作间接证据。
- [ ] 窗口记忆「零闪现」只能靠常驻 watcher 进程（代价：常驻 + 卸载残留），**待与用户确认**。
- [ ] cooling 预检更准：现在只扫 importers 直连依赖，传递依赖靠反应式报错兜底；要覆盖全量 lockfile 得有更狠的缓存/批量策略。
- [ ] 面板与 pnpm 的 registry 对齐（`registry.npmjs.org` vs `.npmrc` 的 npmmirror；镜像未同步会「面板说有、装时报 no-matching-version」），可用 `pluginManager.registries()`。
- [ ] `pendingBuilds` 的「允许脚本并重试」入口（`installBundle(spec, { approvedBuilds })`）；`removable === false` / `optional` / `readOnlyReason` 的 bundle 隐藏或标注（否则以 `management-required` 失败）；`installBundle` 补 `registry` 参数；插件禁用/卸载时的 DOM 清理。
- [x] 归并器收尾（0.1.6 做了一半）：`.bak` 只留 3 份、解析与强制豁免共用 `excludeBlockOf`、14 条回归测试。**剩下**：豁免表里空行/纯注释行会让扫描提前结束（只漏收敛、不误删）。
- [ ] `PUB_TIME_CACHE` 有「超 500 条清过期项」兜底但无 LRU/硬上限；cooling 反推窗口依赖「报错新鲜度」，偏大即多标，可改用 host 侧策略真值。
- [ ] `鈺?`/`鉁?` 残渣的根因在 host 侧读 pnpm stdout 的解码（UTF-8 按 CP936 解），client 只能剥 ANSI；根治要动解码或让 host 回报已解码文本。

## 发布

- npm 不允许覆盖已发布版本：**先升版本，再提交，最后发布**；发版前 `npm pack --dry-run` 看清单（`files` 曾把笔记写成 `DEVELOPING.md`，实际是 `DEVELOPMENT.md`，一直没进包，0.1.5 已修）。
- 版本号在 `package.json` 和 `lib/client.js` 的 `BUILD` 常量两处：
  ```sh
  npm version patch        # 或手改 version；记得同步 BUILD
  git add -A && git commit -m "..." && git push
  npm publish
  ```
- **Token**：npm 2025-11 起只支持 granular token，要有 **Bypass 2FA**：npmjs.com → Access Tokens → Generate New Token → Packages 选 **All Packages + Read and Write (publish and stage)**、Organizations 选 **No access**、勾 **Bypass two-factor authentication**；再 `npm config set //registry.npmjs.org/:_authToken=npm_xxx`（写用户级 `.npmrc`——`.gitignore` 已排除 `.npmrc` 与 `*.tgz`）。
- 包是 scoped（`@nimoxie/dsh-ui-tweaks`），`publishConfig.access: "public"` 已在 package.json。
