# dsh-ui-tweaks

给 DSH（DeepSeek Harness）的 Web UI 的一批界面微调：装上即生效，无需配置。

官方界面上有几处用得难受的地方：宽表格会撑出对话区右沿、滚动条贴在屏幕最右端要横跨半屏去够、Windows 关闭「动画效果」时前端动画被系统设置一并关掉、插件版本更新只能去插件管理页挨个看。这个插件把它们一次性修掉，另附一项桌面客户端的窗口记忆。

## 功能

**宽表格越界修复**
- 宽表格（≥4 列）不再撑出对话区，收敛回正文列并支持横向滚动，观察沿裁掉的问题消失。

**对话区左侧滚动条**
- 在右侧宽度调整条的左边放一条自绘滚动条：拖拽、点轨道翻页、滚轮转动手感与原生一致，主题跟随明暗。
- 只在会话页出现，切到插件页等非会话页自动移除。

**动画修复**
- Windows 关闭「动画效果」时 Chromium 会向网页报告 `prefers-reduced-motion: reduce`，本插件清除因此失效的前端动画规则，让动画恢复；web 与桌面客户端都生效。

**插件更新检查**
- 插件管理页「已安装」标题那一行的右侧多两枚按钮：「检查更新」比对已装插件与 npm registry 的版本，有新版本可点上就地更新，支持全部更新与中途取消（不检查 dsh 本体与官方 `@deepseek-ai` 插件——它们的更新走 dsh 本体流程）。
- 新版本还没过 pnpm 的发布时长窗口（默认 24 小时）时，该行标 **「冷静期中」** 并给出可更新时间，到点自动变回可更新；确需立刻安装，可在详情里走「强制更新」，它会先检查这次安装会不会被别的包连累拦下。
- 新版声明了更高的 DSH 最低版本时，该行标 **「DSH 不符」**（鼠标悬停显示「需要 DSH ≥ x」），不给点——省得装上去起不来。
- 更新成功后，面板顶部常驻一条「重启客户端后生效」提示；旁边的「**立即重启**」会先读一遍会话状态再弹确认：**有会话在跑**就列出来、说明会被中断；**没有会话**则说明不会打断任何任务。**任何情况都要你点一下「重启 dsh」才会执行**（旁边有「取消」）。弹窗里会写明桌面端的两步 —— dsh 先退出，再由客户端弹出官方的「应用无法启动或已意外停止」对话框，**在对话框里点「重启」才会真正拉起来**（也可以手动退出后重开）。两个面板都**不可拖动**，位置只有一个来源：贴在触发它的那枚按钮旁边；下方空间不够时自动翻到按钮上方，滚动或改窗口大小也跟着走。
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

桌面客户端：桌面 profile 由客户端独占管理，CLI 装不了（会被拒），请在客户端「插件管理」页添加包名 `@nimoxie/dsh-ui-tweaks`，重启客户端生效。

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
- 发布未满 24 小时的插件版本不会被安装，面板把它标成「冷静期中」而不是失败；满了之后自动变回「有新版本」，不用守着。
- 更新失败的行会直接给出原因（pnpm 输出与日志位置），点它可重试；取消只作用于你点的那一项，后续排队的会接着装。
- 面板比对走 npm 官方 registry，安装走你本机 pnpm 配置的源（如 npmmirror 镜像）；镜像尚未同步的新版本会出现「面板说有新版、装时报找不到版本」，稍后重试即可。
- 「DSH 不符」只在能确认版本时生效：本机 DSH 版本读不到、或新版写的是 `^`/`~` 这类无法判定的范围，就不拦（宁可漏拦，不误伤正常更新）。
- 与启动器 dsh-web-shell 的分工：界面增强已由本插件接管；dsh-web-shell 的「检查更新」按钮只负责 **dsh 本体**的比对与升级提示。
- 窗口记忆的归位发生在窗口显示后约 0.2~1 秒内，会有一帧跳变（官方客户端在插件加载之前就把窗口显示出来了，没法再早）；窗口最小化不会中断记忆。
- 个别插件（如社区插件管理页扩展）自带单独的「检查更新」入口，与本插件的检查互不关联，结果可能不同。

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

桌面客户端对指令安装有限制，请直接在客户端「插件管理」中进行安装、卸载和查看。

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

# dsh-whale-widget：右下角小鲸鱼挂件
dsh plugin --profile web add dsh-whale-widget
```

## 许可

MIT

---

想自己改这个插件、或者想了解它在内部怎么实现的，见 [DEVELOPMENT.md](./DEVELOPMENT.md)。
