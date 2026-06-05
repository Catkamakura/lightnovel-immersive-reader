[English](README.en.md) · 简体中文

# 轻读LK美化 · LightNovel Immersive Reader

一个单文件的 **Tampermonkey / Violentmonkey 油猴脚本**，在 [www.lightnovel.fun](https://www.lightnovel.fun) 网站之上注入一个干净、类 Google Docs 的**沉浸式阅读器**——*不替换*原站。它同源调用网站自己的 Web API，把章节渲染进一个无干扰的 Shadow-DOM 浮层，记住你读到哪里，并能把整本书导出为 EPUB / TXT，或直接推送进你的 **Calibre** 书库（带真实元数据）。

> 📥 **一键安装**： **[📖 安装脚本 / Install](https://raw.githubusercontent.com/Catkamakura/lightnovel-immersive-reader/main/lightnovel-immersive-reader.user.js)**

> ⚠️ 目前仅适配PC端
## 功能

待补充

## 安装

1. 装一个油猴管理器：**[Tampermonkey](https://www.tampermonkey.net/)** 或 **[Violentmonkey](https://violentmonkey.github.io/)**。
2. 安装脚本：点 **[📖 安装 / Install](https://raw.githubusercontent.com/Catkamakura/lightnovel-immersive-reader/main/lightnovel-immersive-reader.user.js)**（即上面 raw `.user.js` 的链接），油猴会直接弹出安装页；或把 [`lightnovel-immersive-reader.user.js`](lightnovel-immersive-reader.user.js) 内容粘进一个新脚本里。


## 快速使用

- 在**详情页或列表页**，点 **📖 沉浸阅读** 打开阅读器（列表页每张卡片上有一个小 **📖**）。
- 把鼠标移到**左上角菜单**上，浮出控制按钮：
  - **☰**——大纲 / 目录
  - **⤓**——下载整本（EPUB / TXT，可选章节范围）；只有够长、值得导出的书才会出现
  - **⚙**——阅读设置（主题、字号、字体、行距、页宽、缩略图、续读、书库、LLM）以及分步的**功能向导**
- 点右下角的 **✕ 退出** 胶囊或按 **Esc** 离开。退出时网站会停在你正在读的那一章，让背后的页面与之对应。

## 可选：发送到 Calibre 书库

阅读器可以把你刚读的 EPUB经由 [`calibre-bridge/`](calibre-bridge/) 这个 FastAPI 配套服务 POST 进指定的 **Calibre-Web-Automated (CWA)** 书库。

```bash
cd calibre-bridge
cp .env.example .env          # 可选：设置 BRIDGE_TOKEN
docker compose up -d --build
```

这会同时拉起 CWA（Web UI 在 `http://localhost:8083`）和 bridge（`http://127.0.0.1:8788`）。然后在阅读器里打开**设置 → 发送到书库（Calibre）**，勾选*启用书库*，URL 保持 `http://127.0.0.1:8788`，并（可选）粘贴你的 token。下载对话框里就会出现 **📚 发送到书库** 按钮。详见 [`calibre-bridge/README.md`](calibre-bridge/README.md)。

> ⚠️ **实验性 / 风险自负**：calibre-bridge 集成、以及脚本向外部服务的 `@connect`（本地书库 + LLM：api.deepseek.com / api.kimi.com / api.openai.com / api.moonshot.cn）均为**实验性功能**。它们会连接到本机以外的外部服务，**可能产生费用**（LLM 调用），请在了解清楚后**自担风险**使用。你的 API key 与 bridge token 仅保存在本机浏览器的 localStorage 里。这两块功能在设置中默认是**折叠收起**的，并标注了「实验性」。

## 仓库结构

```
lightnovel-immersive-reader-repo/
├── lightnovel-immersive-reader.user.js   # 油猴脚本（单文件，原生 JS IIFE）
├── package.json                          # 校验脚本（Playwright）
├── LICENSE                               # MIT
├── calibre-bridge/                       # 可选的 FastAPI 配套（Python / uv / Docker）
│   ├── bridge/                           # main.py, epub_meta.py, calibre.py, store.py, config.py
│   ├── tests/                            # pytest 测试
│   ├── docker-compose.yml                # CWA + bridge
│   ├── Dockerfile
│   ├── pyproject.toml
│   └── README.md
├── verify/                               # headless 校验脚本
│   ├── verify-userscript.mjs
│   ├── verify-webnovel.mjs
│   └── verify-lib.mjs
├── docs/                                 # 文档 wiki（见下）
├── AGENTS.md                             # 给 AI 编码 agent 的导览
└── CLAUDE.md                             # → 指向 AGENTS.md
```

## 文档

> 以下文档（`docs/*.md` 与 `AGENTS.md`）均为**英文**，面向开发者 / LLM agent。

如果你是 LLM agent，从这里开始：**[`AGENTS.md`](AGENTS.md)**（项目地图、命令、约定、坑）。

[`docs/`](docs/) 下的 wiki：

- [`docs/architecture.md`](docs/architecture.md) — 脚本、网站 API、bridge 如何协作；所有状态存在哪里；两种阅读模式。
- [`docs/userscript.md`](docs/userscript.md) — 脚本的开发者 / LLM 参考：`S` 状态、API 助手、分章、渲染、导航、缩略图、书签、续读、设置。
- [`docs/metadata.md`](docs/metadata.md) — 元数据流水线与 EPUB OPF 署名映射（规则化 + 可选 LLM、MARC relator 角色、标签兜底）。
- [`docs/lk-web-api.md`](docs/lk-web-api.md) — 本项目所消费的 lightnovel.fun Web API（信封、端点、阅读模型、「文章内无进度」这一发现）。
- [`docs/calibre-bridge.md`](docs/calibre-bridge.md) — bridge：端点、模式、本地 / Docker 运行、部署、测试。
- [`docs/development.md`](docs/development.md) — 如何开发与校验；约定与坑。
- [`calibre-bridge/README.md`](calibre-bridge/README.md) — bridge 自己的快速开始 + 远程 / Tailscale 部署。

## 开发 / 校验

阅读器是单个原生 JS 文件，无构建步骤。校验通过 Playwright 在 headless 下运行：

```bash
npx playwright install chromium    # 一次性：装浏览器
npm run verify                     # verify-userscript.mjs
npm run verify:webnovel            # 网文（系列）模式
npm run verify:lib                 # 发送到书库路径
```

bridge 有自己的 Python 测试（在 `calibre-bridge/` 内 `uv run pytest`）。

## 许可证

[MIT](LICENSE) © masiro
