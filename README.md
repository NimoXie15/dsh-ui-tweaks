# dsh-ui-tweaks

给 DSH（DeepSeek Harness）的 Web UI 的一批界面微调：装上即生效，无需配置。

## 它解决什么问题

官方界面上有几处用得难受的地方：宽表格会撑出对话区右沿、滚动条贴在屏幕最右端要横跨半屏去够、Windows 关闭「动画效果」时前端动画被系统设置一并关掉、插件版本更新只能去插件管理页挨个看。这个插件把它们一次性修掉。

## 功能

**宽表格越界修复**
- 宽表格（≥4 列）不再撑出对话区，收敛回正文列并支持横向滚动，观察沿裁掉的问题消失

**对话区左侧滚动条**
- 在右侧宽度调整条的左边放一条自绘滚动条：拖拽、点轨道翻页、滚轮转动手感与原生一致，主题跟随明暗
- **只在会话页出现**，切到插件页等非会话页自动移除

**动画修复**
- Windows 关闭「动画效果」时 Chromium 会向网页报告 `prefers-reduced-motion: reduce`，本插件清除前端几十处因此失效的动画规则，让动画恢复
- web 与桌面客户端都生效

**插件更新检查**
- 插件管理页顶部多一枚「检查更新」按钮（刷新按钮左侧，样式与「添加插件」按钮一致）：比对已装插件（官方 `@deepseek-ai` 插件除外）与 npm registry 的版本，有新版本可点上就地更新，支持全部更新与中途取消
- 不检查 dsh 本体，也不检查 `@deepseek-ai` 官方插件——两者的更新都由 dsh 本体的更新流程负责（桌面端自带更新器；web 端本体升级走 `npm install -g @deepseek-ai/dsh@next`）

## 安装

dsh 目前有浏览器版与桌面客户端两种形态，命令里的 `<profile>` 就是安装目标环境：浏览器用 `web`，桌面客户端用 `desktop`。

```sh
dsh plugin --profile <profile> add @nimoxie/dsh-ui-tweaks
```

- 浏览器版（`web`）：装完重启服务（关掉再 `dsh web`）。
- 桌面客户端（`desktop`）：桌面 profile 由客户端独占管理，请在客户端的「插件管理」页添加本包（包名 `@nimoxie/dsh-ui-tweaks`）。

卸载（CLI 可管理的环境）：

```sh
dsh plugin --profile <profile> remove @nimoxie/dsh-ui-tweaks
```

别人也可以从 GitHub 或本地目录装（开发用）：

```sh
dsh plugin --profile <profile> add github:NimoXie15/dsh-ui-tweaks
dsh plugin --profile <profile> add link:/absolute/path/to/dsh-ui-tweaks
```

> **要求**：dsh `>= 0.2.0-rc.1`（需要 `remote.pluginManager` / `remote.pluginInventory` 接口）。
>
> 升级插件后如果界面没变化，按 **Ctrl+Shift+R** 强刷一次（浏览器可能还在用缓存的旧版本）。

## 已知限制

- 非 npm 来源的插件没有可比的 registry 版本，直接跳过比对：`link:` / `file:` 本地路径标「本地链接」；`git:` / `github:` / `http` 直装标「Git 直装」（例如 `github:Fisfzy/dsh-ego-browser` 会显示为 Git 直装，即使 npm 上有同名包，装的也是仓库源码、与 npm 版本不是一回事）
- `@deepseek-ai` 官方插件直接从检查列表里剔除：它们的更新由 dsh 本体流程负责
- 更新走 profile 内的插件安装接口，与官方插件管理页同源；安装按 registry 解析出的**精确版本号**发起（而非 `@latest`），不受 pnpm 发布时长策略（minimumReleaseAge）拦挡，刚发布的版本也能装
- 个别插件（如社区插件管理页扩展）自带单独的「检查更新」入口，与本插件的检查互不关联，结果可能不同
- 与启动器 dsh-web-shell 的分工：对话区滚动条、宽表格修复等界面增强已由本插件接管，dsh-web-shell 自身不再注入；其「检查更新」按钮仍负责 **dsh 本体**的比对与升级提示

## 许可

MIT

---

想自己改这个插件、或者想了解它在内部怎么实现的，见 [DEVELOPING.md](./DEVELOPING.md)。