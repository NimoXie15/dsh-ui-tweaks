# 开发笔记

面向改这个插件的人。用户文档在 [README.md](./README.md)。

## 骨架（与 dsh-model-organizer 同构）

- `lib/index.js`：host 半区，挂两条回环路由（`GET /api/ui-tweaks/local-plugins` 本地包识别、`POST /api/ui-tweaks/normalize-excludes` 豁免表归并），并在加载时静默归并一次；细节见「更新检查」。
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

### 关键经验：pnpm 的 minimumReleaseAge 是主要的静止源（0.1.5 起分成两条路径看）

- **`minimumReleaseAge` 有两条独立的作用路径，别混为一谈**（0.1.5 修订；0.1.4 这段只写对了一半）：
  1. **门禁（在解析之前）**：`pnpm install/add` 一上来就校验**磁盘上现有的** lockfile，任一 entry 的发布时间落在窗口内 → **整体中止整个 profile 的安装**并报 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`（exit 1）。这一步与"你要装什么"无关，**写精确版本号也救不了**。
  2. **解析（在门禁之后）**：候选不合法时 pnpm 会挑「最新合法版本」（于是装上后版本没变 → 面板判「暂缓」）；但**显式写 `name@版本`** 时它会打印 `Added 1 entry to minimumReleaseAgeExclude in pnpm-workspace.yaml` 并照常安装——这条仍然成立，只是它管不了第 1 条。
- **豁免表的坑（0.1.5 实测）**：`minimumReleaseAgeExclude` 里同一个包名出现**多条**时**只有文件中靠前的那条生效**（不是并集）。同一份 lockfile/yaml 只改顺序：`[pkg@0.69.0, pkg@0.61.0]` 通过、`[pkg@0.61.0, pkg@0.69.0]` 失败。于是陈旧条目**静默遮蔽**新条目，此后每次安装都被门禁拦下；而一次成功的未成熟安装又会把新条目**追加在末尾**，让旧条重新变成靠前那条 → 下一次安装立刻失败。**这就是 0.1.5 之前用户侧「更新某插件 → 报一长串 pnpm 错误 → 之后所有插件都装不上」的真因。**
- **对策（0.1.5）**：host 半区新增归并器 `normalizeReleaseAgeExcludes()`（`lib/index.js`），把该表收敛成「每包一条」——同包多条只留"与 lockfile 锁定版本一致"的那条（否则留靠前那条）；受管包名（profile `dependencies` 里的）唯一条且版本 ≠ 锁定版本 → 删除；非受管且不重复的条目不动。结果恒为原条目的**子集**（绝不比现状更宽松）。触发：插件加载时静默一次 + `POST /api/ui-tweaks/normalize-excludes`（client 在安装落地成功后与「重新检查」时 fire-and-forget 调用）。安全约束：只改 `minimumReleaseAgeExclude` 这一段、其余字节逐字节保留；写前留 `pnpm-workspace.yaml.bak-<时间戳>`；同目录临时文件 + `renameSync` 原子替换；写后重读校验；无变化不写盘；幂等；异常一律不外抛。
- **客户端「冷静期中」(cooling)**：两条判定路——① 预判：拉该包**全量 packument** 读 `time[版本]`（`/<pkg>/latest` 与 abbreviated packument 都**没有** `time`，实测），`发布时间 + 窗口 > 现在` 即标 cooling；② 反应式：门禁报错里同时有 `published at <ISO>` 与 `cutoff <ISO>`，于是 `窗口 = now − cutoff`、`成熟时刻 = 发布 + 窗口`（前提是刚失败就解析，秒级误差）。反推窗口只接受 (0, 30 天]，越界退回会话默认值（真实值会从首次报错学到）。cooling 标签**不可点击安装**（点它必然撞门禁、还可能连累整个 profile），只切换详情；`enqueue` 里还有第二道闸。
- **cooling 副标题（0.1.6 改写）**：原来一句话里塞了「供应链冷静期 / minimumReleaseAge / 门禁 / profile」四个未解释术语，末句还是「不是本插件的问题」这种防御性措辞。现在固定三层：①结论与时间（`还需等待 11 小时 1 分才能更新（10-15 08:07 到期，到点这一行会自动变回可更新）`）→ ②为什么有这段等待（把 dsh 的 24 小时策略讲成人话）→ ③现在硬装的后果（连坐整个 profile，故不提供直接安装）；等待期已过/结束时间未知各有专门文案（已过期时不再说"会被拦下"，避免自相矛盾）。换行由 `.why` 的 `white-space:pre-wrap` 呈现。
- **到期自动重查（0.1.6）**：`scheduleCoolingRefresh(name, matureAt)` 给 cooling 行排一个到点（+3s 缓冲）的 `checkOne(name)` 定时器，按包名去重（重复预判/重查只留最后一个）；触发点＝`applyCoolingGuess` 预判落 cooling 后、`judge` 的冷却分支落 cooling 后。超时上限（约 24.8 天）之外不排。这样用户不必记时间，到点自动变回「有新版本」。
- **本机实测环境**：dsh 用的是**自带的 pnpm 11.7.0**（`<DSH_HOME>/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm`），**不是** PATH 上那个（本机 PATH 是 11.21.0）。排查这类问题必须用前者复现，否则结论会反过来。
- 参考实现：社区分叉版 `@linxin666/dsh-client-ui-plugin-manager` 的 update handler 也是先 `fetchManifest` 拿 registry 的 `version`，再 `installBundle(name@version)`——它「能更新」不是因为绕过了门禁，而是因为它用的是精确版本（只绕开第 2 条路径）。

### 本地包识别 = host 路由为主，404 签名兜底

- `listBundles()` 不透传安装来源（`installed` 不是 spec 字符串），而发布到 npm 的本地包（如 `@nimoxie/dsh-model-organizer`）连 registry 404 签名都不命中 —— 所以 host 半区挂了 `GET /api/ui-tweaks/local-plugins`（读 profile `package.json` 的 dependencies，按 source 分两类回给面板：**local** = `link:`/`file:` 本地路径，标「本地链接」；**remote** = `git:`/`github:`/`http` 直装，标「Git 直装」；仅回环放行）；0.1.5 起还有第二条回环路由 `POST /api/ui-tweaks/normalize-excludes`（见上面的归并器）。两者都**不参与 registry 比对**——即使 npm 上有同名包（如 `dsh-ego-browser` 有 `github:` 声明、registry 也存在 0.8.6），装的也是仓库源码、与 npm 版不是一回事。client 每轮检查先取这份名单，取不到（host 半区未重启）再退回 404 签名（404 时也按 `installed` 来源区分 local/remote）。**改 host 半区必须重启 dsh/客户端才生效**（client bundle 刷新即可）。
  profile 目录定位：先从 `import.meta.url` 向上找带 `dsh.profile.bundles` 且包含自身的 package.json（npm 直装必命中）；软链安装时模块被解析到 profile 外的真实目录，退回 `DSH_HOME/profiles/*` 扫描，多 profile 命中时按 `ELECTRON_RUN_AS_NODE` 区分 desktop/web。

### 其它要点

- **更新主路径全部走官方 remote API**（host 半区两条回环路由：本地包识别 + 豁免表归并）：`pluginManager.listBundles()`（清单+版本）、`installBundle("<名>@版本", { enabled, requestId })`（更新）、`waitForInstall(requestId)`（**仅**响应丢失后的恢复）、`cancelInstall(requestId)`（取消，回 `{status}`）。
- **`installBundle` 是「等到装完才返回」的调用，它的返回值就是终态**（0.1.4 的关键纠正）：remote 信封是 `{ok, value}`，`value` 即 `{changed, application, stage, target, enabled?, error?, warnings?, packageResult?, bundle?, pendingBuilds?, approvedBuilds?, registries?, failedAt?}`。官方桌面端插件页也是 `await installBundle(...)` 之后直接 `settleInstall(result.value)`。
- **`waitForInstall` 不是进度轮询器**（**0.1.3 的理解是错的，那正是「更新永远超时」的真因**）：它只用于**响应丢失后**恢复同一请求的结果，请求不在活动中时返回 `null`，而且**已完成的结果不保留**。`installBundle` 已经 await 到装完，此时再轮询 `waitForInstall` 必然一路读到 `null` → 空转到 240s 看门狗 → 面板报「更新超时」，真实结果（成功或 pnpm 报错）全被丢掉。0.1.4 起：正常路径只读 `res.value`；**仅当信封本身失败（`res.ok === false`，结果未知）**才调一次 `waitForInstall` 恢复，仍为 `null` 就如实报「已发起·未确认」。
- **终态判定读 `application`**：`applied` / `restart-required`（都算成功，后者提示重启）→ 回读版本核对；`cancelled` → 该行退回「有新版本」（取消不是失败，仍可重试）；`failed` → 行标「更新失败」，并把 `error.code`（译成中文）+ `error.diagnostic` + `packageResult.kind/exitCode/output/logPath` + `pendingBuilds` + `failedAt` 一起写进行内 `why`（**成熟期违规例外**：报错里带 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` 时不落 `failed`，判成 `cooling`，并把反推出来的窗口记进会话供预判复用）；`overridden` → 提示被覆盖、可重试；未知值一律按「结果未知」处理，不硬判成功。
- **回读版本是唯一成功判据**：只有在 `listBundles()` 里读到该行版本、且**与安装前不同**时才判「已是最新」。回读**只用 `pluginManager.listBundles()`**——`pluginInventory` 只有 `list()` 没有 `listBundles`（踩过，会造成「回读版本失败」假阳性）；装完瞬间清单可能短暂不可用，重试 3 次（1.5s 间隔）。比对基准 `busyBefore` 在 `startOne` 抓取，**不受中途「重新检查」重建行的影响**。
- **registry 比对在浏览器直连**：`registry.npmjs.org` 带 CORS *（实测），逐包**串行** fetch `/latest`，不打并发。代价要知道：比对源是 npmjs，而安装走 pnpm 自己的 registry（本机 `.npmrc` 指向 npmmirror）——镜像尚未同步到的新版本会「面板说有、装时报 no-matching-version」（见「待办」）。
- **取消要分清对象**（0.1.4 修）：排队项点取消只把它自己摘出队列（`cancelQueued`）；在装项点取消才 `cancelInstall(requestId)`，且**保留队列**，等这次落定后 `done() → pump()` 接着装下一项。旧实现 `requestCancel` 里一句 `queue = []` 把整个队列清空，于是「等待更新」的项全部退回「有新版本」不再开始——这就是「取消一项后，等待的项不更新、反而变回有新版本」的真因。`cancelInstall` 的回值 `{status: cancelled|not-running|too-late}` 也要读：`too-late` 说明已进入应用阶段、取消不掉，得如实告诉用户。
- **重新检查必须回填在飞状态**（0.1.4 修）：`checkNow` 重建 `rows` 会把「更新中/等待更新」抹成「有新版本」，而 `busyName`/`queue` 仍在——此时点那一行会撞上 `enqueue` 的 `name === busyName` 保护而**静默无反应**（这就是「重新检查后无法更新」的真因），真正在装的那一项也失去取消入口。修法是重建行后立刻 `reconcileInstallStates()` 把 busy/queuing 盖回去，且这两种行不参与 registry 比对。
- **总看门狗（0.1.4 起只是兜底）**：正常路径一次 `installBundle` 就定案，不必再等 240s；看门狗只覆盖 fetchLatest（现场查 registry，fetch 无超时）这类异常分支，触发时报「结果未知」并 `cancelInstall`。
- **`enabled` 用清单里的真实状态**：`installBundle` 的 `enabled` 传 `!(row.enabled === false)`，保留用户手动禁用的选择（旧实现一律 `enabled: true`，会把禁用的插件重新启用）。
- **失败原因要可见**：`fail` / `unchanged` / `unconfirmed` / `error` / `cooling` 行在行下多渲染一行 `.why`——只放在 `title` 悬停提示里，等于 pnpm 的报错没显示。0.1.5 起渲染前先 `stripAnsi`（CSI/OSC/控制字符/CRLF，否则用户第一屏是一串 `鈺?` 残渣），并把 `diagnostic` 与 `packageResult.output` 互相包含时只留更完整的一份（dsh 常把同一份 pnpm 输出摘成两段）；`cooling` 的完整诊断默认折叠，点标签才展开（`.dtl`）。


## 动画修复（模块 4）

- **原理**：Windows「动画效果」关闭 → Chromium 报 `prefers-reduced-motion: reduce`，dsh 的 40 处（17 包）`@media (prefers-reduced-motion: reduce)` 规则关掉动画。页面内**删不掉媒体查询的求值**，但删得掉规则本身：dsh 的 CSS 全部经 `<style>` 标签注入（实测 0 处 adoptedStyleSheets），同源 sheet 的 `cssRules` 可遍历可 `deleteRule`——把 reduce 的整条递归删除，基础动画声明（非媒体内）立即生效。效果与 dsh-web-shell 的 CDP `Emulation.setEmulatedMedia` 等价，但**不需要调试端口，桌面端也能用**。
- **JS 门控**：chat 包 3 处 `matchMedia("(prefers-reduced-motion: reduce)")`（滚动平滑 vs 跳转）用 `window.matchMedia` 包装覆盖——在返回的 MediaQueryList 上 `defineProperty("matches")` 影子化，按 no-preference 应答。包装必须在应用渲染前（apply 在合成期，早于 mount）。
- **晚到样式**：分包懒加载/换肤重写会在加载后重建样式，靠 `MutationObserver(head)` 防抖重扫 + 2s 轮询兜底（纯 CSSOM 枚举，无布局开销）。
- **取舍**：与 dsh-web-shell 的 `forceAnimations` 相同——覆盖系统无障碍设置。窗口级覆盖（启动器）换成会话级覆盖（插件），想恢复系统行为就得停用本插件；将来要做成可开关就着 dsh-model-organizer 的设置卡方案。
- web 窗口里本模块与 dsh-web-shell 的 CDP 覆盖并存是**无害冗余**（都指向 no-preference）。

## 窗口记忆（模块 6，仅 host 半区）

官方桌面客户端主窗口写死 1280×820 居中、主进程无任何窗口状态持久化（app.asar 里 `createWindow` 无 placement 逻辑）；渲染层 `contextIsolation+sandbox` 且 `dshDesktop` 桥只暴露给 `dsh-app://app` 主框架——client 半区拿不到任何窗口能力。因此实现走**进程外**：host 半区 spawn 隐藏 PowerShell helper（`lib/window-helper.ps1`），Win32 互操作来自 `lib/window-helper.cs` 预编译的 `window-helper.dll`（拷到 profile 的 `ui-tweaks/` 下运行）。

- **为什么不是独立 exe（重要，别走回头路）**：先做过 csc 编译的 winexe 版，结果 Windows/安全软件对本地编译的无签名 exe 反复弹「无法验证发布者」、且会被静默拦截（进程秒退、无任何日志）。改成 **DLL 由 PowerShell 进程内加载**：零安全提示。且 DLL 必须用 `Assembly.Load(byte[])` 字节流加载——profile 在云盘/虚拟盘路径上时 `Add-Type -Path`/`LoadFrom` 会报 `0x80131515` 不支持操作。
- **找宿主进程的坑（实测）**：客户端进程树是 `主进程 -> --expose-internals -> spawn-bridge -> dsh 运行时`，**四层全叫 `DeepSeek Harness.exe`**（运行时是 ELECTRON_RUN_AS_NODE=1 的 Electron）。所以既不能从运行时自己开始匹配（把自己当宿主），也不能取第一个同名祖先（匹配到无窗口的中间层）——必须**沿父链向上走到最后一个同名进程**（树根 = 主进程）。走链用 ntdll `NtQueryInformationProcess` + .NET Process（无 WMI，冷启动 100ms~2s 的延迟吃过亏）。
- **恢复时机 = catch-up，这是物理极限（有时间线实测）**：客户端先隐藏创建窗口、随后 show，**而 dsh 运行时加载完本插件发生在 show 之后**（实测时间线：窗口 t+0 隐藏创建 → t+2.5 客户端 show → t+3.0 插件 apply → t+3.4 helper 首次轮询 → t+3.5 归位）。所以「赶在 show 前归位」从插件侧原理上做不到——那段隐藏期属于客户端自己的启动流程，插件还没被加载；能压缩的只有我们自己的 0.2s（spawn+初始化+识别），明细见下。若要真正零闪现，唯一办法是一个**常驻 watcher 进程**（不属于运行时、跨客户端重启存活、守候下一次启动的隐藏窗口）——代价是后台常驻进程 + 卸载后残留的自清理问题，未采纳。
- **归位用「隐藏→移动→显示」三明治**：对已可见窗口直接 `SetWindowPos`，用户会看到窗口先停在默认位置再滑走；改为先 `SW_HIDE`、移动、再按原前台状态 `SW_SHOW`/`SW_SHOWNA`（`GetForegroundWindow` 判定，不抢焦点）。默认位置的可见时间因此压到归位前一刻，跳变只剩一帧。
- **最小化窗口必须能被跟踪（修过）**：`GetWindowRect` 对最小化窗口返回 `(-32000,-32000) 160x28`，用它做尺寸门槛会把窗口筛掉、helper 随即报「window gone」并**停止记录**——用户最小化一次就断线，状态停在旧值（实测踩过，是「记忆没生效」的主要来源）。修法：候选窗口的尺寸判定改用 `GetWindowPlacement` 的 `rcNormalPosition`。最大化判定也不能只看 `showCmd==3`：最大化后被最小化时 `showCmd==2` 但 `flags` 含 `WPF_RESTORETOMAXIMIZED(0x2)`，不认它会把「最大化」记成「窗口化」（见 `[DshWin]::MaximizedState`）。
- **识别宿主窗口**：枚举宿主 PID 的顶层窗口，过滤 `Chrome_WidgetWin_1` + `WS_THICKFRAME`（可缩放）+ ≥400×300，取最大者。欢迎窗（600×700 固定）、更新弹窗因此天然被排除；窗口标题是动态的（跟随页面），不能靠标题。
- **最大化恢复**：`SetWindowPos` + 需要时 `ShowWindow(SW_MAXIMIZE)`；`rcNormalPosition` 两种状态通吃（最大化时保存的是窗口化矩形），取消最大化不会错位。
- **保存**：1s 一拍 `GetWindowPlacement`，`showCmd==3` 判最大化；按「值签名」比对（不含时间戳，否则每秒落盘一次），变化才写，`WriteAllText(tmp)` + `Move-Item -Force` 原子覆盖。恢复前用 `MonitorFromRect(MONITOR_DEFAULTTONULL)` 校验坐标仍在某块显示器上，防拔显示器后窗口开到屏幕外。
- **生命周期**：看门狗盯两个 PID（dsh 运行时、Electron 主进程）任一消失即退出；单实例用锁文件（`window-helper.lock` 存 PID，新 helper 校验存活并杀旧的——旧版按 cmdline 匹配杀过双 helper 并存的跟头）；helper 是运行时的子进程，运行时被杀时随进程树一起死。
- **⚠️ 编码坑（三次实测中招）**：所有生成的 .ps1 必须带 **UTF-8 BOM**（`lib/index.js` 已加 `\ufeff`）。PS 5.1 对无 BOM 脚本按 ANSI/GBK 解析，中文注释的 UTF-8 字节流会错误配对、**吞掉换行把下一行代码并进注释**——症状是赋值静默不执行/here-string 解析错乱，无任何报错（Parser 都能 parse 过）。用工具生成的临时测试 .ps1 同样要纯 ASCII。
- 文件落点：`<desktop profile>/ui-tweaks/{window-helper.cs, window-helper.dll, window-helper.ps1, window-helper.lock, window-state.json, window-helper.log}`（日志超 96KB 自动截尾）。删 `window-state.json` = 重置记忆。


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
- [x] 0.1.5：新增「冷静期中」(cooling)——预判（全量 packument 的 `time`）+ 报错反推成熟时刻，标签不可点击安装、`enqueue` 二次拦截；host 半区新增 `minimumReleaseAgeExclude` 归并器与 `POST /api/ui-tweaks/normalize-excludes`（安装成功/重新检查时 fire-and-forget）；失败文案剥 ANSI、同一份 pnpm 输出去重、cooling 详情折叠；纠正 0.1.4 关于 `minimumReleaseAge` 的半个结论。
- [x] 0.1.6：桌面客户端窗口记忆（预编译 DLL + PowerShell helper）；更新落地后头部常驻「重启生效」提示条；cooling 副标题改三层文案 + 到期自动重查；归并器/窗口 helper 的两个实测 bug 修复（最小化窗口断线跟踪、归位改「隐藏→移动→显示」）。
- [ ] cooling 的「强制更新（跳过 minimumReleaseAge）」：**技术上可行**（精确版本 spec 会让 pnpm 自动写豁免表；host 半区本来就有写 `pnpm-workspace.yaml` 的能力），但门禁校验的是**整个 lockfile**，所以必须先做成熟度预检（列出其它会被拦下的包）+ 交互上要显式二次确认 + 动手前用自带 pnpm 11.7.0 真机验证一次强制路径。**待与用户确认是否要做。**
- [ ] 窗口记忆「零闪现」：唯一途径是常驻 watcher 进程（不属于 dsh 运行时、跨客户端重启存活、守在客户端启动前归位）；代价是后台常驻进程 + 卸载后残留需自清理。**待与用户确认是否接受这个代价。**
- [ ] cooling 预检（lockfile 成熟度扫描）：为「这次安装会不会被门禁拦下、被谁拦下」提供提前诊断；需拉 N 个包的发布时间，有耗时/缓存设计问题，建议与上面「强制更新」一起做。
- [ ] 比对 registry 与安装 registry 对齐：面板查 `registry.npmjs.org`，pnpm 走 `.npmrc`（npmmirror）。镜像未同步的新版本会造成「面板说有新版、装时报 no-matching-version」。可用 `pluginManager.registries()` 取实际 registry 再比对（需先确认镜像的 CORS）。
- [ ] `pendingBuilds` 的「允许这些脚本并重试」入口（`installBundle(spec, { approvedBuilds })`）。现在只在失败行里列出待授权名单。
- [ ] `removable === false` / `optional` / 带 `readOnlyReason` 的 bundle 在面板隐藏或标注——否则点了会以 `management-required` 失败。
- [ ] `installBundle` 的 `registry` 参数补齐（官方传了，本插件省略）。
- [ ] 插件被禁用/卸载时的运行时清理（目前 DOM 残留到页面刷新为止）。
- [ ] 归并器收尾：`.bak-<时间戳>` 会随每次改写累积（改成只留最近 N 个或固定单名）；`minimumReleaseAgeExclude` 里出现空行/纯注释行时扫描会提前结束（只漏收敛、不误删），可顺手修成跳过空行继续扫。
- [ ] cooling 的反推窗口依赖"报错新鲜度"：解析被延迟时反推窗口会偏大（现有 30 天上限兜底），偏大表现为**多标**冷静期；可考虑优先用 host 侧策略真值而不是反推。
- [ ] `鈺?`/`鉁?` 这类残渣的根因在 host 侧读 pnpm stdout 时的解码（UTF-8 被按 CP936 解），client 只能剥 ANSI；根治要动解码或让 host 回报已解码文本。

## 发布

- npm 不允许覆盖已发布的版本号：**先升版本，再提交，最后发布**。
- **发版前先 `npm pack --dry-run` 看一眼清单**：`files` 里曾把开发笔记写成 `DEVELOPING.md`（实际文件名是 `DEVELOPMENT.md`），于是它一直没进包；0.1.5 已修。
- 版本号同时在 `package.json` 和 `lib/client.js` 的 `BUILD` 常量里（改两处）。发版命令：
  ```sh
  npm version patch        # 或手改 package.json 的 version；记得同步 BUILD
  git add -A && git commit -m "..." && git push
  npm publish
  ```
- **Token**：npm 2025-11 起只支持 granular token，发布需要有 **Bypass 2FA** 的权限：npmjs.com → 头像 → Access Tokens → Generate New Token → Packages 选 **All Packages + Read and Write (publish and stage)**、Organizations 选 **No access**、勾 **Bypass two-factor authentication**；然后 `npm config set //registry.npmjs.org/:_authToken=npm_xxx`（写进用户级 `.npmrc`，不要放进仓库——`.gitignore` 已排除 `.npmrc` 与 `*.tgz`）。
- 包是 scoped（`@nimoxie/dsh-ui-tweaks`），`publishConfig.access: "public"` 已写在 package.json，`npm publish` 不需要额外参数。
