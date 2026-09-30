# @nimoxie/dsh-ui-tweaks

[DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) Web UI 的微调合集插件。装上即生效，无需配置。

## 功能

- **宽表格越界修复** —— 修复 dsh 本体的一个 CSS 缺陷（≥4 列表格撑出对话区、右沿被裁掉还看不到滚动条）。放弃官方的「出血」布局，把宽表格收敛回正文列，横向可滚动。
- **对话区左侧滚动条** —— 对话区的原生滚动条贴在最右缘，宽屏下要横跨半屏去够；本插件在右侧宽度调整条的左边放一条自绘的常显滚动条：拖拽、点轨道翻页、滚轮转动手感都与原生一致，主题自动跟随明暗，且**只在会话页出现**、切到插件页等非会话页自动移除。
- **动画修复** —— Windows 关闭「动画效果」时 Chromium 会报告 `prefers-reduced-motion: reduce`，dsh 前端几十处媒体查询规则把动画全关（圈圈不转、流光消失）。本插件在页面内清除这些覆盖规则并让 `matchMedia` 按「有动画」应答，效果与 dsh-web-shell 的调试端口覆盖相同，**web 与桌面客户端都生效**。
- **插件更新检查** —— 会话工具栏多一枚「插件更新」按钮：逐个比对**全部已装插件**与 npm registry 的版本，弹面板列出（名字 / 当前版本 → 远端 / 状态标签）；**有新版本的插件点标签就地更新**，支持「全部更新」与中途取消。**不检查 dsh 本体**（桌面客户端自带更新器；web 端本体升级请走 `npm install -g @deepseek-ai/dsh@next`）。

## 环境要求

- dsh `>= 0.2.0-rc.1`（依赖 0.2.x 的 `remote.pluginManager` / `remote.pluginInventory` 接口）。
- web / 桌面客户端均可（桌面端同样适用，但桌面端有自己的本体更新，本插件的更新检查只覆盖插件）。

## 安装

```sh
# 从 npm 安装
dsh plugin --profile <profile> add @nimoxie/dsh-ui-tweaks

# 本地开发（软链，改完 Ctrl+Shift+R 即生效，见 DEVELOPING.md）
dsh plugin --profile <profile> add link:<本仓库路径>
```

## 注意

- 本插件是启动器 dsh-web-shell 的配套插件：对话区滚动条、宽表格修复等界面增强已由本插件提供，`dsh-web-shell` 自身不再注入（其「检查更新」按钮仍负责 **dsh 本体**的比对与升级提示）。
- 更新走 profile 内的插件安装接口，与官方插件管理页同源；`link:` / `file:` / `git+` 直装的插件没有可比的 registry 版本，会标为「本地链接」跳过。

## 开源协议

[MIT](./LICENSE)
