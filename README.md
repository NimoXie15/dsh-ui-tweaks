# dsh-ui-tweaks

给 DSH（DeepSeek Harness）的 Web UI 的一批界面微调：装上即生效，无需配置。

官方界面上有几处用得难受的地方：宽表格会撑出对话区右沿、滚动条贴在屏幕最右端要横跨半屏去够、Windows 关闭「动画效果」时前端动画被系统设置一并关掉、插件版本更新只能去插件管理页挨个看。这个插件把它们一次性修掉，另附一项桌面客户端的窗口记忆。

## 功能

**宽表格越界修复**
- 宽表格（≥4 列）不再撑出对话区，收敛回正文列并支持横向滚动，观察沿裁掉的问题消失。

**对话区左侧滚动条**
- 在右侧宽度调整条的左边放一条自绘滚动条：拖拽、点轨道翻页、滚轮转动手感与原生一致，主题跟随明暗。
- 只在会话页出现，切到插件页等非会话页自动移除。

**回合尾「本回合改动」卡（官方数据复活 + 兜底）**
- 官方那张「本回合改动」卡的摘要与逐行对比只活在会话内存里，会话一被释放（切走、重启客户端、重开旧会话）就 404，卡片直接不画。本插件**不重画这张卡**：它在官方卡要数据的那一刻，用**会话日志里的 `meta.diffs`** 按官方形状重算一份顶上去，于是**官方组件原生渲染**——卡头、图标、统计、4 行折叠、hover 迷你 diff、右侧「改动审查」面板全是官方的，外观与活会话里一模一样。
- **只在官方不会画的两种情形，才由本插件自己画一张**（不会与官方卡重复）：① 设置里关着**「显示编码工具视图」**（官方卡受这个开关约束）；② 该回合**根本没有 `workspace/changes` 公告**。这两张兜底卡照官方骨架做（同样 60px 卡头、图标块、千分位统计、4 行折叠 + 「全部 N 个」、hover 迷你 diff），**点卡头或行同样打开官方右侧「改动审查」**；区别只有：编码视图关的那张把来由放在鼠标悬停提示里，「无公告」那张在底部留一行小字说明（因为那一轮官方从来没有过记录）。
- **口径**：只覆盖**文件工具**（写/改文件）造成的改动；用脚本、`npm install` 之类改出来的内容不在此列（那只有官方卡含，官方数据还在时不受影响）。数字按官方口径算——**回合首末的净变化**，所以同一文件在一个回合里改多次只算一次净结果（旧版按分段累加，数字会略大，属正常差异）。

**动画修复**
- Windows 关闭「动画效果」时 Chromium 会向网页报告 `prefers-reduced-motion: reduce`，本插件清除因此失效的前端动画规则，让动画恢复；web 与桌面客户端都生效。

**插件更新检查**
- 插件管理页「已安装」标题那一行的右侧多两枚按钮：「检查更新」比对已装插件与 npm registry 的版本，有新版本可点更新，支持全部更新与中途取消（不检查 dsh 本体与官方 `@deepseek-ai` 插件——它们的更新走 dsh 本体流程）。更新的做法是**先卸载该插件、再用新版本装回去**（DSH 的安装接口在有热重载时不允许原地覆盖已装的包，会直接报 `already-installed`）；中途失败会**自动装回原来的版本**。
- 新版本还没过 pnpm 的发布时长窗口（默认 24 小时）时，该行标 **「冷静期中」** 并给出可更新时间，到点自动变回可更新；确需立刻安装，可在详情里走「强制更新」，它会先检查这次安装会不会被别的包连累拦下。
- 新版声明了更高的 DSH 最低版本时，该行标 **「DSH 不符」**（鼠标悬停显示「需要 DSH ≥ x」），不给点——省得装上去起不来。
- 更新成功后，面板顶部常驻「重启客户端后生效」。旁边的「**立即重启**」会先看有没有会话在跑：**有**就列出来、说明会被中断，**没有**则说明不会打断任何任务；**任何情况都要你点一下「重启 dsh」才会执行**。桌面端要两步 —— dsh 先退出，再由客户端弹出官方的「应用无法启动或已意外停止」对话框，**在那里点「重启」才真正拉起来**（也可手动退出后重开）。点下去后**整页会被蒙住**（此刻客户端已不可用）；20 秒没退成就自动撤掉、提示你刷新页面或手动重启。两个面板都**不可拖动**，位置只有一个来源：贴在触发它的那枚按钮旁，下方放不下就翻到上方。
- 两个弹窗都能**纯键盘操作**：Tab 逐枚走过「重新检查 / 全部更新 / ×」和每一行的标签，**回车或空格**即触发（与鼠标走同一套逻辑，不存在两套行为），**Esc** 收起；焦点环用官方主题令牌，与原生控件同色同宽；收起后焦点回到触发它的那枚按钮。
- 安装落地后会自动清理 profile 里会让后续所有安装都失败的豁免表冗余（后台静默完成，无需你操作）。

**窗口记忆（仅桌面客户端）**
- 官方客户端每次启动都是固定的 1280×820 居中小窗，本插件让它记住上次的窗口大小、位置和最大化状态，下次启动自动还原。
- 不修改官方客户端任何文件，卸载即完全还原官方行为；浏览器版不动作。
- 状态存在 profile 的 `ui-tweaks/window-state.json`，删掉即重置记忆。

## 安装

浏览器版（`web`）：

```sh
dsh plugin --profile web add @nimoxie/dsh-ui-tweaks
```

装完重启服务（关掉再 `dsh web`）。

桌面客户端：桌面 profile **保留给客户端**，PATH 上那个 `dsh`（npm 全局装的）会被拒。但客户端**自带的那份 CLI 可以** —— 它就在安装目录里，和「插件管理」页走的是同一套实现：

```sh
# Windows 桌面端；<安装目录> 形如 E:\tools\DeepSeek Harness
"<安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add @nimoxie/dsh-ui-tweaks
```

不想敲命令，也可以照旧在客户端「插件管理」页添加包名 `@nimoxie/dsh-ui-tweaks`，重启客户端生效。

卸载（CLI 可管理的 `web` 环境）：

```sh
dsh plugin --profile web remove @nimoxie/dsh-ui-tweaks
```

别人也可以从 GitHub 或本地目录装（开发用）：

```sh
dsh plugin --profile web add github:NimoXie15/dsh-ui-tweaks
dsh plugin --profile web add link:/absolute/path/to/dsh-ui-tweaks
```

> **要求**：dsh `>= 0.2.0-rc.1`（需要 `remote.pluginManager` / `remote.pluginInventory` 接口）。
>
> 升级插件后如果界面没变化，按 **Ctrl+Shift+R** 强刷一次（浏览器可能还在用缓存的旧版本）。

## 已知限制

- 非 npm 来源的插件没有可比的 registry 版本，直接跳过比对：`link:` / `file:` 本地路径标「本地链接」，`git:` / `github:` / `http` 直装标「Git 直装」（例：`github:Fisfzy/dsh-ego-browser` 装的是仓库源码，与 npm 上的同名包不是一回事）。
- 更新失败的行会直接给出原因（pnpm 输出与日志位置），点它可重试；取消只作用于你点的那一项，后续排队的会接着装。
- 面板比对走 npm 官方 registry，安装走你本机 pnpm 配置的源（如 npmmirror 镜像）；镜像尚未同步的新版本会出现「面板说有新版、装时报找不到版本」，稍后重试即可。
- 会话在用「自动审查」时，更新面板顶部会有琥珀色提醒：该模式下装/更新插件可能失败，工具调用也可能被审查拦掉（`503` / `429`）。按提醒切成「工作区内修改」，装完再切回即可。本插件**只提示，不改动你的权限设置**。
- 「本回合改动」卡的口径见上文（只含文件工具的改动，且按官方净变化口径计数）。已释放会话里卡是**官方的**，数据由本插件按官方形状顶上；「官方那侧会不会画」的判断结果**只在本次连接内有效**（刷新页面或重连后重新判断）——这是为了防止宿主恢复数据后出现双份卡。
- 「DSH 不符」只在能确认版本时生效：本机 DSH 版本读不到、或新版写的是 `^`/`~` 这类无法判定的范围，就不拦（宁可漏拦，不误伤正常更新）。
- 更新一个**已经装过**的插件时，点确认后会看到它先被「卸载」再以新版本装回：这是 DSH 安装接口的限制（有热重载时不允许原地覆盖已装的包，会直接拒绝并报 `already-installed`），官方界面里也只能「先卸载再安装」。中途失败会自动装回原来的版本，并在该行写明原因。
- 与启动器 dsh-web-shell 的分工：界面增强已由本插件接管；dsh-web-shell 的「检查更新」按钮只负责 **dsh 本体**的比对与升级提示。
- 窗口记忆的归位发生在窗口显示后约 0.2~1 秒内，会有一帧跳变（官方客户端在插件加载之前就把窗口显示出来了，没法再早）；窗口最小化不会中断记忆。
- 个别插件（如社区插件管理页扩展）自带单独的「检查更新」入口，与本插件的检查互不关联，结果可能不同。
- **360 提示「PowerShell 执行攻击命令」是误报**：桌面端的窗口记忆需要在 dsh 进程外跑一个隐藏的 PowerShell 小助手，360 对「非系统程序创建 powershell.exe」一律按高危拦截，选「允许」即可，功能不受影响。这不是本插件独有的问题 —— dsh 官方桌面版每次启动自己也会创建隐藏 PowerShell（采集系统信息、提取图标），所以关掉窗口记忆也消不掉这个弹窗。

## 本人常用插件（可选）

> 本插件不会自动安装任何其他插件，插件也不属于必装项——不装同样能正常使用上述全部功能。

浏览器端操作：

```sh
# 安装
dsh plugin --profile web add <PluginName>

# 卸载
dsh plugin --profile web remove <PluginName>

# 查看
dsh --profile web --dump-config | findstr /i <PluginName子串>
```

桌面客户端：PATH 上的 `dsh` 装不了（桌面 profile 被保留给客户端），但客户端自带的那份 CLI 可以 —— 把上面的 `dsh plugin --profile web` 换成：

```sh
"<安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add <PluginName>
```

也可以直接在客户端「插件管理」中进行安装、卸载和查看。

常用插件（web 与桌面端都能用）：

```sh
# @changfenhuang/dsh-genui：生成式消息回复
dsh plugin --profile web add @changfenhuang/dsh-genui

# @linxin666/dsh-session-archive：会话归档与批量清理
dsh plugin --profile web add @linxin666/dsh-session-archive

# @liustack/modsearch：联网搜索
dsh plugin --profile web add @liustack/modsearch

# @michengai/dsh-skills-manager：技能加载与管理
dsh plugin --profile web add @michengai/dsh-skills-manager

# @nimoxie/dsh-model-organizer：模型显示管理
dsh plugin --profile web add @nimoxie/dsh-model-organizer

# @nimoxie/dsh-ui-tweaks：界面优化调整
dsh plugin --profile web add @nimoxie/dsh-ui-tweaks

# cc-safety-net：危险命令与密钥防护
dsh plugin --profile web add cc-safety-net

# dsh-context：上下文管理
dsh plugin --profile web add dsh-context

# dsh-cost-meter：会话费用统计
dsh plugin --profile web add dsh-cost-meter

# dsh-ego-browser：模拟浏览器点击
dsh plugin --profile web add dsh-ego-browser

# dsh-ops：bash / PowerShell 7 与 Rust 高性能工具
dsh plugin --profile web add dsh-ops

# dsh-whale-widget：右下角小鲸鱼挂件
dsh plugin --profile web add dsh-whale-widget
```

## 许可

MIT

---

想自己改这个插件、或者想了解它在内部怎么实现的，见 [DEVELOPMENT.md](./DEVELOPMENT.md)。
