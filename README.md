# dsh-ui-tweaks

给 DSH（DeepSeek Harness）的 Web UI 的一批界面微调：装上即生效，无需配置。

官方界面有几处用得难受的地方：宽表格会撑出对话区右沿、滚动条贴在屏幕最右端要横跨半屏去够、Windows 关闭「动画效果」时前端动画被系统设置一并关掉、会话释放后回合尾的改动卡会消失、插件版本更新只能去插件管理页挨个看。这个插件把它们一次性修掉，另附桌面客户端的窗口记忆。

## 功能

**宽表格越界修复**
- ≥4 列的宽表格不再撑出对话区，收敛回正文列并支持横向滚动。

**对话区左侧滚动条**
- 在右侧宽度调整条的左边放一条自绘滚动条：拖拽、点轨道翻页、滚轮手感与原生一致，主题跟随明暗，只在会话页出现。

**回合尾改动卡**
- 官方「本回合改动」卡在会话释放后（切走会话、重启客户端、重开旧会话）原本会消失；本插件用会话日志里的文件改动数据补上，卡片仍由**官方组件原样渲染**——卡头、统计、4 行折叠、hover 预览、右侧「改动审查」都与活会话里一致。
- 官方本来就不会画的两种情形（关着「显示编码工具视图」、该回合没有官方改动记录）才由插件画一张同款，两种情形都不会与官方卡重复。
- 口径：只含**文件工具**（写/改文件）造成的改动；数字按回合首末的**净变化**计。

**动画修复**
- Windows 关闭「动画效果」时，清除因此失效的界面动画；web 与桌面客户端都生效。

**插件更新检查**
- 插件管理页「已安装」标题行右侧多一组按钮：检查更新、逐个更新、全部更新与取消（不检查 dsh 本体与官方 `@deepseek-ai` 插件）。
- 未过 pnpm 发布冷静期的新版本标「冷静期中」并给出可更新时间，到点自动恢复；确需立刻安装可在详情里走「强制更新」。声明了更高 DSH 版本的标「DSH 不符」。两者默认都不给装。
- 更新成功的插件会在顶部提示「重启客户端后生效」；「立即重启」会先告诉你有没有会话在跑，**任何情况都要你点确认**才会执行。
- 面板与弹窗支持纯键盘操作（Tab / 回车 / 空格 / Esc），焦点环与官方控件一致。

**窗口记忆（仅桌面客户端）**
- 记住上次的窗口大小、位置与最大化状态，下次启动自动还原；不修改官方任何文件，卸载即恢复。
- 状态存在 profile 的 `ui-tweaks/window-state.json`，删掉即重置。

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
- 更新一个**已经装过**的插件时会先卸载再装回：DSH 安装接口在有热重载时不允许原地覆盖已装的包。中途失败会自动回滚到原版本，失败原因（pnpm 输出与日志位置）写在该行，点它可重试。
- 桌面端点「重启 dsh」后 dsh 会先退出，再由客户端弹出官方的「应用无法启动或已意外停止」对话框，**在那里点「重启」才真正拉起来**（也可手动退出后重开）。
- 取消只作用于你点的那一项，后续排队项会继续装；面板比对走 npm 官方 registry，安装走你本机 pnpm 配置的源（如 npmmirror 镜像），镜像尚未同步的新版本会出现「面板说有新版、装时报找不到版本」，稍后重试即可。
- 「本回合改动」卡只含文件工具的改动，且按官方净变化口径计数；「官方那侧会不会画」的判断结果**只在本次连接内有效**（刷新页面或重连后重新判断），用于避免宿主恢复数据后出现双份卡。
- 「DSH 不符」只在能确认版本时生效：本机 DSH 版本读不到、或新版写的是 `^` / `~` 这类无法判定的范围，就不拦（宁可漏拦，不误伤正常更新）。
- 会话在用「自动审查」时，更新面板顶部会有琥珀色提醒：该模式下装/更新插件可能失败，工具调用也可能被审查拦掉（`503` / `429`）。按提醒切成「工作区内修改」，装完再切回即可。本插件**只提示，不改动你的权限设置**。
- 与启动器 dsh-web-shell 的分工：界面增强已由本插件接管；dsh-web-shell 的「检查更新」按钮只负责 **dsh 本体**的比对与升级提示。
- 窗口记忆的归位发生在窗口显示后约 0.2~1 秒内，会有一帧跳变（官方客户端在插件加载之前就把窗口显示出来了）；窗口最小化不会中断记忆。
- 个别插件（如社区插件管理页扩展）自带单独的「检查更新」入口，与本插件的检查互不关联，结果可能不同。
- **360 提示「PowerShell 执行攻击命令」是误报**：桌面端的窗口记忆需要在 dsh 进程外跑一个隐藏的 PowerShell 小助手，360 对「非系统程序创建 powershell.exe」一律按高危拦截，选「允许」即可。dsh 官方桌面版每次启动自己也会创建隐藏 PowerShell，所以关掉窗口记忆也消不掉这个弹窗。

## 本人常用插件（可选）

> 本插件不会自动安装任何其他插件，插件也不属于必装项——不装同样能正常使用上述全部功能。

```sh
# 浏览器版
dsh plugin --profile web add <PluginName>
dsh plugin --profile web remove <PluginName>
dsh --profile web --dump-config | findstr /i <PluginName子串>   # 查看

# 桌面客户端（PATH 上的 dsh 装不了，用客户端自带的那份）
"<安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add <PluginName>
```

也可以直接在客户端「插件管理」中安装、卸载和查看。常用插件（web 与桌面端都能用）：

| 插件 | 用途 |
| --- | --- |
| `@changfenhuang/dsh-genui` | 生成式消息回复 |
| `@linxin666/dsh-session-archive` | 会话归档与批量清理 |
| `@liustack/modsearch` | 联网搜索 |
| `@michengai/dsh-skills-manager` | 技能加载与管理 |
| `@nimoxie/dsh-model-organizer` | 模型显示管理 |
| `@nimoxie/dsh-ui-tweaks` | 界面优化调整（本插件） |
| `cc-safety-net` | 危险命令与密钥防护 |
| `dsh-context` | 上下文管理 |
| `dsh-cost-meter` | 会话费用统计 |
| `dsh-ego-browser` | 模拟浏览器点击 |
| `dsh-ops` | bash / PowerShell 7 与 Rust 高性能工具 |
| `dsh-whale-widget` | 右下角小鲸鱼挂件 |

## 许可

MIT

---

想自己改这个插件、或者想了解它在内部怎么实现的，见 [DEVELOPMENT.md](./DEVELOPMENT.md)。
