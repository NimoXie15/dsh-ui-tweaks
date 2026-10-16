# 开发笔记

面向改这个插件的人。用户文档在 [README.md](./README.md)。

## 骨架（与 dsh-model-organizer 同构）

- `lib/index.js`：host 半区，挂五条回环路由 —— 本地来源识别 + 运行中 DSH 版本（`GET /api/ui-tweaks/local-plugins`，含 `dsh` 字段）、豁免表归并（`POST /api/ui-tweaks/normalize-excludes`）、强制预检与写豁免（`POST precheck-exempt` / `POST force-exempt`）、立即重启（`GET|POST /api/ui-tweaks/restart`）；加载时还会静默归并一次。细节见「更新检查」与「立即重启」。
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
- **桌面 profile 由 Electron 独占管理**：npm 版 CLI 装/卸会被拒（报错 `managed exclusively by the Electron application`）。**但客户端自带的那份 CLI 可以（0.1.8 修订）**：`<客户端安装目录>/resources/runtime/cli/bin/dsh.cmd` 走 `dsh-desktop-host/lib/cli.js`，它以 `manageDesktopProfile: true` 调 `runCli`，于是 `dsh plugin --profile desktop add|remove <包>` 与「插件管理」页是同一套实现（同一条 pnpm、同一把 `package.json` 文件锁、同样自动登记 `dsh.profile.bundles`）；实测用它连装 5 个插件、全部成功。三条路：① 上面这份自带 CLI（最省事，装完重启客户端生效）；② 客户端插件管理页安装，spec 填 `link:<路径>`；③ 应用完全退出后手动改四件套（package.json 依赖 + `dsh.profile.bundles`、pnpm-lock importers、node_modules 软链）。客户端会监听 package.json 变化、自动用自带 pnpm 建好软链。

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
  - **0.1.6 收尾**：段落解析与强制豁免**共用** `excludeBlockOf`（原先两份复制代码是隐患：两个写者对「块从哪到哪」必须一致，否则又会造出遮蔽条）；备份/原子替换收敛到 `atomicWriteWorkspace`，并**只保留最近 3 份 `.bak`**（归并器每次加载都跑，旧备份原本会无限堆积）；补了 14 条回归测试（`dirOverride` 指向临时目录，不碰真实 profile）：重复折叠 / 陈旧剪除 / 裸名豁免 / 非受管不动 / 块外字节逐字节不变 / 无变化不写盘 / 无键 / 无 lockfile / `.bak` 上限。
- **成熟期硬闸（0.1.6，装前校验）**：光靠行状态拦不住点不点得动 —— 实测（用户撞到）：预判还在飞（要拉全量 packument，慢）时那一行还是可点的「有新版本」，点下去 `startOne` 用精确版本 spec，而精确版本会被 pnpm 自动写进豁免表并照常安装 → **未成熟版本被静默装了进去，没有任何确认**，与强制流程的设计意图正好相反。现在 `startOne` 在 `installBundle` 之前调 `guardMaturity(名字, 目标版本, 放行回调)`：未成熟且非强制 → 不装，落回 cooling（回填成熟时刻 + 技术细节 + 排自动重查）并清空 busy 状态；强制流程写 `forcedNames[name]`（一次性凭据，用后即删、`done()` 终态也清）。判定表（隔离测试 10/10）：未成熟且非强制＝拦；有凭据＝放行并消费；已成熟＝放行；registry 没给该版本发布时间＝放行；packument 查询失败＝放行；目标版本未知（`@latest` 兜底路径）＝放行。后三条是**刻意**的：数据源不可用时不该挡住正常更新（宁可漏拦、不误伤），要守的是「窗口内明确可判定时拦住」。
- **客户端「冷静期中」(cooling)**：两条判定路——① 预判：拉该包**全量 packument** 读 `time[版本]`（`/<pkg>/latest` 与 abbreviated packument 都**没有** `time`，实测），`发布时间 + 窗口 > 现在` 即标 cooling；② 反应式：门禁报错里同时有 `published at <ISO>` 与 `cutoff <ISO>`，于是 `窗口 = now − cutoff`、`成熟时刻 = 发布 + 窗口`（前提是刚失败就解析，秒级误差）。反推窗口只接受 (0, 30 天]，越界退回会话默认值（真实值会从首次报错学到）。cooling 标签**不可点击安装**（只切换详情）；`enqueue` 里还有第二道闸，只有强制流程带 `force` 能过，装前还有第三道闸见上。
- **强制更新（0.1.6，跳过冷静期）**：真机实测（自带 pnpm 11.7.0，用客户端自己的 Electron 以 `ELECTRON_RUN_AS_NODE=1` 跑 `pnpm.cjs`，隔离临时工程，样本＝发布 4 小时的 `undici@8.12.1`）：
  1. **精确版本 spec 装未成熟版本 → 成功**：pnpm 打印 `Added 1 entry to minimumReleaseAgeExclude in pnpm-workspace.yaml` 并自行写入豁免表。→ 0.1.5 里「写精确版本也救不了」只对**无污染 lockfile** 成立。
  2. **豁免表为空 + lockfile 含未成熟条目**：跑 `install`（无事可做）→ 开头校验、整体失败、**磁盘零改动**；**但若安装有活要干，安装照常落地、门禁在结尾才报错 exit 1**（实测 T2b/T3c）。→ 强制流程必须**先预检、拒绝在动手之前**；"先试一下看报什么错"会把 profile 留在「装上了但命令报错」的混乱态。
  3. **遮蔽语义确认**：`[陈旧条, 未成熟条]` 失败、`[未成熟条, 陈旧条]` 通过 → 写入必须把目标版本放**块内第一条**。
  - 实现：host 两条回环路由 `POST /api/ui-tweaks/precheck-exempt`（只读预检）与 `POST /api/ui-tweaks/force-exempt`；`forceExemptVersion` 只动豁免段落（目标插到块首、其余字节逐字节保留、写前备份＋同目录临时文件＋renameSync＋写后重读校验；**有意突破**归并器「结果恒为子集」那条约束——它就是要加一条）；`precheckExempt` 只扫 **profile 直连依赖**（lockfile 的 importers 段）＋发布时刻 10 分钟缓存，列出「未生效豁免且仍在窗口内」的包（传递依赖不扫：几百次网络查询不划算，漏判由安装失败时的反应式报错兜底，pnpm 会点名违规条目）。客户端在冷却详情里给三段式交互（入口 → 预检 → 拦路者清单/二次确认 → 写豁免 → 走正常安装），`enqueue(name, { force: true })` 是唯一放行冷却行的入口。
  - 验证：host 隔离 15/15（写入位置、字节保留、去重、预检筛选、目标跳过、豁免生效后不再拦）；UI 渲染 9/9（入口/预检中/拒绝清单/二次确认/失败态）；真机路由实测（真实 profile 上 `precheck-exempt` 返回 `{ok:true,blocked:[]}`，`local-plugins` 回归正常）。
- **cooling 文案（0.1.6 定稿）**：列表里默认只有**一句话**——`0.70.0 还需等待 10 小时 40 分才能更新（10-15 07:54 到期，点标签看详情）`（原文案把「供应链冷静期 / minimumReleaseAge / 门禁 / profile」四个未解释术语塞在一句里，末句还是「不是本插件的问题」这种防御性措辞）。完整解释走 `coolingReasonText(detail, windowMs)`，**只在点「冷静期中」标签展开时渲染**（`.dtl`）：为什么有这段等待（dsh 的 24 小时策略讲成人话）→ 冷却期内硬装的后果（连坐整个 profile，故不提供直接安装）→ 到点自动恢复 → 末尾附原始诊断（预检＝registry 记录，反应式＝pnpm 报错）。等待期已过 / 结束时间未知各有专门文案；已过期时不再说「会被拦下」，避免自相矛盾。换行由 `.why` 的 `white-space:pre-wrap` 呈现。
- **到期自动重查（0.1.6）**：`scheduleCoolingRefresh(name, matureAt)` 给 cooling 行排一个到点（+3s 缓冲）的 `checkOne(name)` 定时器，按包名去重（重复预判/重查只留最后一个）；触发点＝`applyCoolingGuess` 预判落 cooling 后、`judge` 的冷却分支落 cooling 后。超时上限（约 24.8 天）之外不排。这样用户不必记时间，到点自动变回「有新版本」。
- **兼容门禁（0.1.7，借鉴 plugin-manager）**：新版的 registry 清单可能声明运行它的 DSH 最低版本（`dsh.engines.dsh` → 顶层 `engines.dsh` → `peerDependencies["@deepseek-ai/dsh"]`，同一套取值顺序）。本机版本由 host 半区读 `profileContext.installAnchor` 的清单（打包桌面端唯一答得上的来源），兜底读 profile 里的 `@deepseek-ai/dsh`。低于要求 → 该行标 **「DSH 不符」**（悬停给「需要 DSH ≥ x」）、不给点，也不计入「全部更新」。**只认 `>=x.y.z`**；未声明、写法不认识（`^`/`~`）、本机版本读不到 → 一律不拦（宁可漏拦，不误伤正常更新；装前还有 pnpm 自身与守卫兜着）。
- **「Auto review」提醒条（0.1.7，只读不改）**：DSH 0.2.0-rc.2 的已知缺陷 —— 访问模式为 `auto` 的会话会让 `permissionPresets` 服务在热重载（装/更新插件就会触发）时构造失败（`pinInitialPermission` 在构造期遍历已驻留会话，`autoAdmit` 还没注册就抛错），表现为装插件报一长串错、连带的 `sessionProjections` 等服务也起不来，要重启客户端才恢复。我们在面板顶部加一条琥珀色提醒，**只读检测**「是否有驻留会话的 permissions 投影 currentValue === 'auto'」（读法同官方权限面板：`ctx.get('sessions')` → `list.getSnapshot().ids` → `binding(id).session.projections.faceOf('permissions').getSnapshot()`），拿不到就当作"没有"（宁可不提示也不误报）；**不写任何权限设置、不拦操作**。
- **面板脚注**：底部常驻一句「只检查第三方插件；官方 @deepseek-ai/ 包随 DSH 本体升级。」（与 plugin-manager 同款口径，把边界写在明处）。
- **本机实测环境**：dsh 用的是**自带的 pnpm 11.7.0**，**不是** PATH 上那个（本机 PATH 是 11.21.0）；排查这类问题必须用前者复现，否则结论会反过来。桌面客户端的自带运行时在 **`<客户端安装目录>/resources/runtime/`**：`pnpm/`（11.7.0 包）、`bin/node`（shim，实际 exec `$DSH_DESKTOP_NODE_EXECUTABLE`＝客户端自己的 Electron + `ELECTRON_RUN_AS_NODE=1`）、`versions.json`（node 24.18.1 / pnpm 11.7.0）。复现命令形如：`ELECTRON_RUN_AS_NODE=1 npm_config_minimum_release_age=1440 "<客户端>/DeepSeek Harness.exe" --expose-internals "<客户端>/resources/runtime/pnpm/bin/pnpm.cjs" add <pkg>@<ver> --registry=https://registry.npmjs.org/`（`minimumReleaseAge` 由 dsh 以环境变量注入，不在任何配置文件里）。
- 参考实现：社区分叉版 `@linxin666/dsh-client-ui-plugin-manager` 的 update handler 也是先 `fetchManifest` 拿 registry 的 `version`，再 `installBundle(name@version)`——它「能更新」不是因为绕过了门禁，而是因为它用的是精确版本（只绕开第 2 条路径）。

### 本地包识别 = host 路由为主，404 签名兜底

- `listBundles()` 不透传安装来源（`installed` 不是 spec 字符串），而发布到 npm 的本地包（如 `@nimoxie/dsh-model-organizer`）连 registry 404 签名都不命中 —— 所以 host 半区挂了 `GET /api/ui-tweaks/local-plugins`（读 profile `package.json` 的 dependencies，按 source 分两类回给面板：**local** = `link:`/`file:` 本地路径，标「本地链接」；**remote** = `git:`/`github:`/`http` 直装，标「Git 直装」；仅回环放行）；0.1.5 起还有第二条回环路由 `POST /api/ui-tweaks/normalize-excludes`（见上面的归并器）。两者都**不参与 registry 比对**——即使 npm 上有同名包（如 `dsh-ego-browser` 有 `github:` 声明、registry 也存在 0.8.6），装的也是仓库源码、与 npm 版不是一回事。client 每轮检查先取这份名单，取不到（host 半区未重启）再退回 404 签名（404 时也按 `installed` 来源区分 local/remote）。**改 host 半区必须重启 dsh/客户端才生效**（client bundle 刷新即可）。
  profile 目录定位：先从 `import.meta.url` 向上找带 `dsh.profile.bundles` 且包含自身的 package.json（npm 直装必命中）；软链安装时模块被解析到 profile 外的真实目录，退回 `DSH_HOME/profiles/*` 扫描，多 profile 命中时按 `ELECTRON_RUN_AS_NODE` 区分 desktop/web。

### 其它要点

- **更新主路径全部走官方 remote API**（host 半区两条回环路由：本地包识别 + 豁免表归并）：`pluginManager.listBundles()`（清单+版本）、`installBundle("<名>@版本", { enabled, requestId })`（更新）、`waitForInstall(requestId)`（**仅**响应丢失后的恢复）、`cancelInstall(requestId)`（取消，回 `{status}`）。
- **`installBundle` 是「等到装完才返回」的调用，它的返回值就是终态**（0.1.4 的关键纠正）：remote 信封是 `{ok, value}`，`value` 即 `{changed, application, stage, target, enabled?, error?, warnings?, packageResult?, bundle?, pendingBuilds?, approvedBuilds?, registries?, failedAt?}`。官方桌面端插件页也是 `await installBundle(...)` 之后直接 `settleInstall(result.value)`。
- **`waitForInstall` 不是进度轮询器**（**0.1.3 的理解是错的，那正是「更新永远超时」的真因**）：它只用于**响应丢失后**恢复同一请求的结果，请求不在活动中时返回 `null`，而且**已完成的结果不保留**。`installBundle` 已经 await 到装完，此时再轮询 `waitForInstall` 必然一路读到 `null` → 空转到 240s 看门狗 → 面板报「更新超时」，真实结果（成功或 pnpm 报错）全被丢掉。0.1.4 起：正常路径只读 `res.value`；**仅当信封本身失败（`res.ok === false`，结果未知）**才调一次 `waitForInstall` 恢复，仍为 `null` 就如实报「未能确认」。
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
- **⚠️ 编码坑（五次实测中招，两个 helper 文件必须纯 ASCII）**：所有生成的 .ps1 必须带 **UTF-8 BOM**（`lib/index.js` 已加 `\ufeff`）。PS 5.1 对无 BOM 脚本按 ANSI/GBK 解析，中文注释的 UTF-8 字节流会错误配对、**吞掉换行把下一行代码并进注释**——症状是赋值静默不执行/here-string 解析错乱，无任何报错（Parser 都能 parse 过）。用工具生成的临时测试 .ps1 同样要纯 ASCII。
  - 0.1.6 又栽了一次**新的变种**：`window-helper.ps1` 里我自己写的中文注释导致 `$cmd = [uint32]0` 被并进注释 —— 生产没问题（index.js 写入时带 BOM），但**仓库里的副本直接跑**（standalone 测试、手动复现）读的是无 BOM 文件 → `[ref]$cmd` 报「无法将 [ref] 应用于不存在的变量」，只在用到该变量时才暴露。所以规则升级为：**`window-helper.ps1` 与 `window-helper.cs` 都保持纯 ASCII**（csc 对无 BOM 源码同样按 ANSI 读），这样有没有 BOM 都不影响；两个文件头都写着 keep pure ASCII，别再往里面塞中文注释。
- **恢复的一个语义补丁**：Windows 对**最大化窗口会忽略 `SetWindowPos`**（位置归显示器所有，`rcNormalPosition` 不变）。所以「存的窗口化状态、当前却是最大化」时归位会静默失效 —— catch-up 分支现在会先 `SW_RESTORE`（`[DshWin]::Restore`，窗口本来就可见，安全）再隐藏/移动，然后按状态决定是否 `SW_MAXIMIZE`。启动路径不受影响（客户端建窗时必是窗口化）。
- 文件落点：`<desktop profile>/ui-tweaks/{window-helper.cs, window-helper.dll, window-helper.ps1, window-helper.lock, window-state.json, window-helper.log}`（日志超 96KB 自动截尾）。删 `window-state.json` = 重置记忆。
- **怎么测（0.1.6 起，已无测试钩子）**：`-TestPid` 那个旁路参数已删除，改成走**真链路**——把**真实客户端**当宿主、把真实 dsh 运行时的 PID 当 `-DshPid`、只换一个**临时状态文件**，于是「沿父链走到最顶层同名进程」这段真的被跑到了（日志能看到完整链条：runtime ← 同名父进程 ← 主进程 ← PowerToys.PowerLauncher 停止）。窗口即使收在托盘也测得了（枚举不看可见性），测完按 `SetWindowPlacement` 把原 placement 还原。走这条路的副产品：**发现 `Program`（C# 里那份编排）早就不等价于 ps1 了**（还用 `GetWindowRect` 判尺寸、只看 `showCmd==3`），于是 0.1.6 把整个 `Program` 删掉（−200 行），`window-helper.cs` 只剩 `DshWin` 互操作层。另：**「把 msedge.exe 改名成 DeepSeek Harness.exe 当假宿主」行不通**——SxS 清单写死了程序名，改名后报「并行配置不正确」，把版本目录做成 junction 也没用。


## 立即重启（模块 7，host 路由 + 独立弹窗）

- **为什么需要**：插件更新只改了磁盘上的 profile，loader 在启动时读清单，所以必须重启才生效。官方插件页没有这个入口，dsh-web-all 家族的 plugin-manager 有一个 —— 本插件自建一份，做法对齐它已经踩过的坑。
- **三段式**：`GET /api/ui-tweaks/restart` 只读「方案」（无副作用，浏览器预取、直接粘 URL 都不会停进程）→ 确认 → `POST` 才执行（先写 `202 {ok,mode}`，约 0.4s 后退出）。非回环 403、其它方法 405。
- **先问会话在不在跑**（本插件比 plugin-manager 多的那一步）：点按钮先并行读「重启方案」和客户端 `sessions` 服务的运行态（`ctx.get('sessions').list.getSnapshot().byId[*].running`，`refresh()` 后读快照，900ms 超时退回旧快照）。**三种结果都落到同一个确认面板**，只是文案不同：N 个在跑 → 列出前 5 个会话标题并说明会中断；0 个 → 说明不会打断任何任务；问不到（服务缺失/形状不认识）→ 按保守说明。**永不自动执行** —— 重启是进程级动作，必须由用户点「重启 dsh」（旁边永远有「取消」；`manual` 模式连重启按钮都不给）。
- **三种模式**（`planRestart` 纯函数，按运行形态判）：① 桌面客户端（`ELECTRON_RUN_AS_NODE=1` 或 `process.versions.electron`）→ `shell`：插件重启不了 Electron 的进程树，只自己退出，由外壳弹它自己的「应用无法启动或已意外停止」对话框（在那里点「重启」才是 `app.relaunch()`）。② 终端里跑的 dsh（stdin/stdout 是 TTY）→ `relaunch`：`node -e <自包含助手>` detached 起一个助手，等旧进程消失（上限 30s）后按**原命令行**重拉，剔除 `--inspect*` / `--debug*`（会让新进程重新绑定端口），新进程 3 秒内秒退最多重试 5 次，日志写 `$DSH_HOME/logs/ui-tweaks-restart.log`。③ 无 TTY / 被监督 → `manual`，如实告诉用户手动重启。
- **绝不把用户丢在没有服务的状态**：`relaunch` 起不了助手就退化为 `manual`（进程留在原地），只有确认能重拉才安排退出；连接先断（宿主已退出）不报成失败，按「已发出请求」收尾。
- **文案按形态讲清「点下去会发生什么」**：桌面端必须说透两步（① dsh 先退出、页面断开；② 客户端弹官方的「应用无法启动或已意外停止」对话框，**在那里点「重启」才会真正拉起来**），并补一句「对话框会写一份崩溃报告；也可手动退出后重开」；`relaunch` 说「服务重拉、正在运行的任务会中断」；`manual` 只说手动重启，**并且不给「重启」按钮**（给了只是骗人）。
- **确认后的蒙皮**：点「重启 dsh」即把整页蒙住（`.rscrim` 与弹窗同一个阴影根，`z-index:2147483000`，弹窗 `…001` 仍在最上层可交互；并拦掉 `wheel`/`touchmove`，免得还能滚下面的页面）—— 客户端此刻已不可用，底下元素不该还能点。蒙皮只在「确认执行」期间存在：失败出口与 `manual` 退化出口都会撤掉它把操作权还给用户；另有 `RST_KILL_WAIT_MS`（20s）兜底 —— 到时页面还活着就撤蒙皮、落 `error` 并提示刷新/手动重启，绝不把人永远蒙在里面。
  - **0.1.8 补的两处（蒙皮只挡指针是不够的）**：键盘仍能 Tab 到蒙皮后面的元素并回车激活，所以 `showScrim(true)` 同时把 `body` 的其它子树整块 `inert`（跳过重启弹窗自己的宿主；Chromium 102+），关掉时逐个还原；另在捕获段接一个 keydown 拦掉 PageDown/PageUp/空格/方向键/Home/End 这类纯滚动键 —— 焦点在弹窗里时不拦（事件 target 会被重定向成宿主），弹窗该能自己滚、按钮也该能用空格触发。
- **确认之后的收尾**：`POST` 成功且模式是 `shell` / `relaunch` 时**停在「正在重启…」**（文案自己讲清下一步：dsh 先退出、到客户端对话框里点「重启」），**不给按钮** —— 宿主 0.4s 后就退出、弹窗随页面一起消失，给「知道了」也点不到（用户实测反馈）。`done`（带可点的「知道了」）只在 `manual` 退化时出现：计划本是 `relaunch`，但助手没起来、宿主不会退出，这时才需要用户点一下收尾。`POST` 回包中断则落 `error`，如实说明「连接中断通常意味着确实在重启，刷新页面看看」，并给「重试」。
- **弹窗定位**：两个面板（更新 / 重启）共用 `placeNear(anchor, wrap, width, minHeight)` —— 贴着触发按钮，**优先放按钮下方**，下方放不下（或不如上方宽裕）就翻到上方；水平夹在视口内；可用空间直接写成 `max-height` 让内容自己滚。`resize` 与 `scroll`（capture）经 rAF 合并后重排；**两个面板都不可拖动**：位置只有一个来源（触发它的那枚按钮），标题栏无移动光标。旧版更新面板支持拖拽并记忆位置，出现过「拖过一次就再也不跟按钮、不跟滚动」的问题（用户实测反馈），现已整段移除 —— 拖拽、`panelPinned`/`panelDragging` 状态、本地存储坐标全部不再存在。
  - **0.1.8 修订：宽度/高度一律实测，别再相信调用方传的常量**。两个弹窗盒模型不同：Shadow DOM 里吃不到官方全局的 `box-sizing` 复位，`.rwrap` 是 content-box 且带 `12px` padding → 真实外框比 `RST_WIDTH=330` 多 **26px**，右缘比按钮多探出 26px；`.wrap` 没有 padding、只差 2px 边框，所以「检查更新」那个看着是齐的，问题被掩盖了很久（用户实测反馈「重启弹窗没跟按钮右侧对齐」才发现）。现在 `measuredBox()` 用 `getBoundingClientRect().width`（与锚点同一坐标系，页面带缩放也不串）当宽度、只拿不到时才退回常量，并从 `maxHeight` 里扣掉 `padding+border`。**以后给任一弹窗加 padding 不必再同步常量。**
  - 同批修正：`room` 不再 `Math.max(120, …)`（按钮贴视口上下边时那会让弹窗连同底部按钮跑到视口外）；上下翻转的判据改用 `scrollHeight`（`offsetHeight` 会被上一次 `maxHeight` 夹住，反复重排时判据会漂）；重排的 scroll 监听用 `composedPath()` 过滤掉面板自身 `.rows` 的滚动（它不影响按钮位置）。
- **颜色语义**：「立即重启」按钮（红描边 + 主题 `label-danger` 文字）与弹窗里的确认按钮都是红色 —— 它是本插件里唯一会打断进行中任务的动作；橙色留给「强制更新」，绿色只留给状态（已是最新 / 已更新 N 个的提示条）。
- **UI**：与更新面板**分家**——重启有自己的 Shadow DOM 弹窗（`dshuiw-restart-panel-host`），按按钮的屏幕矩形定位在它下方；按钮本身挂到官方「已安装」标题行右侧（见下条），常带一圈绿色内描边。
- **按钮位置**：找 `[data-plugin-panel] [data-plugin-group="bundles"]` 的第一个子元素＝「已安装」标题行（plugin-manager 用的同一个座位；标题是页面自己的 chrome，没有插槽席位），把 `span#dshuiw-list-actions` 塞进去靠 `margin-left:auto` 靠右；两个按钮的样式用 dsh 主题变量自绘（座位那一行没有官方按钮可当模子）。React 重渲染会抹掉手插节点，MO + 轮询兜底补挂。
- **测试**（隔离，`%TEMP%\dshuiw-restart-test\`）：host 16/16 —— 四种方案判定、`manual` 不退出、助手失败不退出、`relaunch`/`shell` 恰在 400ms 后退出、5 条路由都注册、`local-plugins` 带 `dsh` 字段、非回环 403、PUT 405、GET 无副作用、POST 202（放子进程里跑，避免测试进程把自己重启）；client 51/51 —— 兼容门禁判定表（含等号边界、`1.10.0 > 1.9.9`、未声明/不认识/版本未知都不拦）、会话运行态（1 个/0 个/服务缺失/只列前 5）、弹窗各态渲染与转义（含 shell 两步说明、`manual` 不给重启按钮、**0 个会话仍要确认并写明不打断任务**）、**任何会话数下都不自动执行**（源码里倒计时相关标识全无）、**弹窗定位**（放得下就在按钮下方、放不下翻到上方、左右夹住、量不到按钮退回右上角、隐藏时不碰它）、接线（先 GET 方案、两个面板都走 `placeNear`、滚动/窗口重排、两个面板都不可拖动、**蒙皮开关与 20 秒兜底**、**Auto review 检测（auto/别的模式/无服务/binding 抛错/无投影五种情况）与提示条文案**、红色语义、按钮挂到 bundles 组、脚注、`dsh` 标签）。
  - **0.1.8 追加的验证**：`wireKeyActivation` 抽出来在 Node 里跑 5 组输入（Enter+按钮 / 空格+按钮 / Enter+非按钮 / 字母 / Tab）—— 只有前两组触发 click 且都 `preventDefault`，后三组不动；三处焦点环规则与 `KBD` 属性经源码断言存在；`placeNear` 用真实盒尺寸（346 无 padding / 356 带 12px padding）离线复算，两个弹窗右缘偏差均为 **0px**（改前 2px / 26px），外框高恰等于可用空间。
- **真机覆盖情况（0.1.8 更新）**：面板的可视行为已由用户真机确认 —— 贴按钮右缘对齐、上下翻转、Tab 焦点环与焦点归位都点过了；`link:` 改动要重启才加载这条路径也反复走过（0.1.7→0.1.8 期间客户端重启多次）。**仍未被单独确证的一点**：由「重启 dsh」按钮触发的那条完整链条（点按钮 → 蒙皮 → 宿主退出 → 客户端弹官方「应用无法启动或已意外停止」对话框）。每次宿主退出都会生成 `crash-*-host.log`，但那份日志无法区分「按钮触发」与「手动退出客户端」；想钉死它只需真点一次。
## 键盘与焦点（0.1.8 起）

弹窗里的控件都是自绘 `<span>`（不是 `<button>`），可点性全靠鼠标 click 委托 —— 代价是键盘完全用不了：Tab 停不上去、回车/空格没反应，读屏也读不出「这是按钮」。这一轮的原则是**只补语义与键盘，不动渲染结构与 CSS**：

- **`role="button" tabindex="0"`（`KBD` 常量）**加在每一处可点元素上：标签行 `.tag.clickable`、强制更新 `.fbtn.*`、头部 `.recheck`/`.allbtn`/`×`、重启弹窗 `.rbtn.*`。
- **Enter/Space 走同一条委托**：`wireKeyActivation(wrap)` 在 `wrap` 上接一个 keydown，只对 `role="button"` 的元素生效，`preventDefault()`（Space 默认会滚页面）后派发一次 `click()` —— 键盘与鼠标共用同一套处理，不会长出第二套行为。
- **焦点环用官方令牌，别自造颜色**：`app.asar` 里有 237 条 `:focus-visible`，主题变量是 `--dsw-focus-ring-width` / `--dsw-focus-ring-color`（回退 `--dsw-alias-state-business-primary`）。三处焦点环（更新面板与重启弹窗的 shadow 样式 + **页面级那两枚自绘按钮**）统一用它们，与原生控件同色同宽。**页面级按钮最容易漏** —— 官方全局样式管不到我们自己 `createElement` 出来的按钮，这正是「Tab 上去没反应/没有焦点环」的真因。
- **焦点管理**：更新面板打开时焦点进面板（`.wrap` 带 `tabindex="-1"` + `role="dialog"`，非模态、页面仍可交互），`×`/Esc 收起后把焦点还给触发按钮（**点外部收起不还** —— 焦点已经跟着用户点的地方去了）；重启弹窗是 `role="dialog" aria-modal="true"`，在确认/失败/收尾态把焦点交给主按钮。判据必须用 `shadowRoot.activeElement`：`document.activeElement` 在 shadow DOM 里返回的是宿主，判不出「里面已经有焦点」，会导致每次重渲染都把焦点抢回主按钮。
- **面板的显示权归「打开/收起」两条路径**：`paint()` 只重画内容，不再无条件 `wrap.hidden = false` —— 否则后台一有动静（装完一个包、冷静期到点自动重查、240s 超时兜底）就会把用户刚收起来的面板又弹回来；收起统一走 `closePanel(refocus)`（`×`/点外部/Esc 三处共用，`refocus` 区分要不要还焦点）。顺带：点自己那枚「检查更新」按钮不再算「外部」，消掉「按下先收起、抬起再展开」的闪动。

## 界面/布局改动的验证手法（0.1.6 起）

面板是 Shadow DOM + 运行时拼字符串，肉眼看不出「差了几个像素」，靠猜会来回改。有效做法是**量出来**：

1. **抽真实 CSS**：求值 `lib/client.js` 里 `sr.innerHTML = "<style>" + …` 那整段表达式，再从结果 HTML 里切出 `<style>` 内容。注意文件里有多处 shadow 样式块（滚动条等），要挑含 `.wrap{position:fixed` 的那个。
2. **复刻 markup**：用真实 CSS + 按 `paint()` 的输出结构手写一段面板 markup，页面里用 `getBoundingClientRect()` 算出各项间距，`fetch("/report")` POST 回本地 Node 服务。
3. **Edge 无头打开**：`msedge --headless=new --disable-gpu --user-data-dir=<每次唯一> http://127.0.0.1:<port>/`。两个坑：① 同一个 user-data-dir 会「移交」给仍在运行的旧实例、导致页面根本不给加载（必须每次唯一，并先清掉残留进程）；② 这个 Edge 上 `--dump-dom` 不输出，所以让页面自己把结果 POST 回来，别指望 stdout。
4. `.why` 是 `white-space:pre-wrap`：测量页里美化的换行/缩进会被当成空白行渲染，内部 HTML 必须紧凑拼接，否则垂直数值全是假的（第一版就被这个骗过：`dtl_border_to_text` 量出 42px，真实是 6px）。

0.1.6 用它抓到一个真 bug：上一版遗留的重复规则 `.fbtn{margin:8px 8px 0 0}` 与新增规则并存，让强制按钮比状态标签多出 8px 右内缩（实测 36 vs 28）；删掉后两者都是 13px、文字到按钮 8px（行盒 16px）。

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
- [x] 0.1.6：桌面客户端窗口记忆（预编译 DLL + PowerShell helper）；更新落地后头部常驻「重启生效」提示条；cooling 行默认一句话（`…才能更新（10-15 07:54 到期，点标签看详情）`）、完整解释与原始诊断收进点标签才展开的详情；cooling 到期自动重查；**强制更新（跳过冷静期）**——host 两条回环路由（预检 + 写生效豁免）、客户端三段式交互、`enqueue(name,{force:true})` 放行；预检发现别的包也会被拦时**直接拒绝并列出**；**装前成熟期硬闸**（`guardMaturity`，堵住「预判未返回时点『有新版本』可静默装未成熟版本」的漏，判定表隔离测试 10/10）；归并器/窗口 helper 的两个实测 bug 修复（最小化窗口断线跟踪、归位改「隐藏→移动→显示」）。
- [x] 0.1.7（已发布 2026-10-16；npm 与 tag `v0.1.7` 一致）：立即重启（模块 7，独立弹窗 + 会话运行态判断）、兼容门禁（`DSH 不符`）、按钮迁到「已安装」标题行右侧并自绘样式、面板加「只查第三方」脚注。
- [x] 0.1.8（已发布 2026-10-17 00:34，npm latest）：弹窗定位改实测外框（修掉重启弹窗右缘与高度各多 26px）、`room` 下限不再突破边距、重排判据与范围收窄；面板显示权归还「打开/收起」；蒙皮补 `inert` 与键盘滚动锁；弹窗控件补 `role/tabindex` + `Enter/Space` + 焦点环与焦点管理；README 补「桌面端自带 CLI 能管 profile」的例外。**遗留：tag `v0.1.8` 还没打**（本地与远端目前都只到 `v0.1.7`）。
- [ ] 窗口记忆「零闪现」：唯一途径是常驻 watcher 进程（不属于 dsh 运行时、跨客户端重启存活、守在客户端启动前归位）；代价是后台常驻进程 + 卸载后残留需自清理。**待与用户确认是否接受这个代价**（用户倾向先继续讨论更优方案）。
- [ ] cooling 预检可以更准：现在只扫直连依赖（importers 段）；传递依赖里若混进未成熟条目，只能靠安装失败时的反应式报错点名。若要覆盖全量 lockfile，得为几百个条目查发布时间（需要更狠的缓存/批量策略，或找 registry 的批量接口）。
- [ ] cooling 预检（lockfile 成熟度扫描）：为「这次安装会不会被门禁拦下、被谁拦下」提供提前诊断；需拉 N 个包的发布时间，有耗时/缓存设计问题，建议与上面「强制更新」一起做。
- [ ] 比对 registry 与安装 registry 对齐：面板查 `registry.npmjs.org`，pnpm 走 `.npmrc`（npmmirror）。镜像未同步的新版本会造成「面板说有新版、装时报 no-matching-version」。可用 `pluginManager.registries()` 取实际 registry 再比对（需先确认镜像的 CORS）。
- [ ] `pendingBuilds` 的「允许这些脚本并重试」入口（`installBundle(spec, { approvedBuilds })`）。现在只在失败行里列出待授权名单。
- [ ] `removable === false` / `optional` / 带 `readOnlyReason` 的 bundle 在面板隐藏或标注——否则点了会以 `management-required` 失败。
- [ ] `installBundle` 的 `registry` 参数补齐（官方传了，本插件省略）。
- [ ] 插件被禁用/卸载时的运行时清理（目前 DOM 残留到页面刷新为止）。
- [x] 归并器收尾（0.1.6 做了一半）：`.bak-<时间戳>` 已改成只留最近 3 份；解析与强制豁免共用 `excludeBlockOf`；14 条回归测试。**剩下**：`minimumReleaseAgeExclude` 里出现空行/纯注释行时扫描会提前结束（只漏收敛、不误删），可顺手修成跳过空行继续扫。
- [ ] 预检缓存的回收策略：`PUB_TIME_CACHE` 已加「超 500 条时清过期项」的兜底，但没有 LRU/硬上限；若以后按下面那条扩到全量 lockfile，需要更狠的批量/缓存策略。
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
