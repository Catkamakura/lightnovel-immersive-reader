[English](README.en.md) · 简体中文

# 轻读LK美化 · LightNovel Immersive Reader

> 🤖 **本项目是一次 100% Vibe Coding 实验**：从每一行代码、全部文档与测试，到下面这支演示视频（录制、运镜指引、剪辑、配音与双语字幕），均由 **Claude Opus 4.8** 与 **Claude Fable 5** 生成完成。

读 [www.lightnovel.fun](https://www.lightnovel.fun) 上的小说，常常意味着忍受论坛排版、一章一页的点击，以及随手关掉就找不回的进度。轻读是一个单文件的 **Tampermonkey / Violentmonkey 油猴脚本**，在原站之上加一层干净、类 Google Docs 的沉浸式阅读层——不替换网站、不改动页面，只是同源调用网站自己的 Web API，把内容重新呈现出来：网文可以一路无缝滚动读到底，读到哪儿记到哪儿，整本书随时导出 EPUB / TXT，或带着完整元数据直接送进你的 **Calibre** 书库。

> 📥 **一键安装**：**[📖 安装脚本 / Install](https://raw.githubusercontent.com/Catkamakura/lightnovel-immersive-reader/main/lightnovel-immersive-reader.user.js)**
>
> ⚠️ 目前仅适配 PC 端

## 🎬 演示视频

三分钟过一遍所有主要功能（画面内置可视化指引与中英双语字幕）：

- **[观看演示（中文配音）](docs/assets/demo-zh.mp4)** · **[English narration](docs/assets/demo-en.mp4)**

无缝滚动读网文时的样子——章节之间是醒目的分隔带，左侧大纲自动跟随，右侧缩略图标出整个章节窗口：

![无缝连续滚动：章节分隔带、大纲与缩略图](docs/assets/readme-flow.png)

## 功能

- **读**——网文像起点一样无缝滚动：滚过章末自动接上下一章、向上滚动接回上一章；章节提前在后台取好，到达边界零等待；左下角的胶囊随时告诉你读到第几章、全书大约百分之几。更喜欢翻页？设置里一键切回一章一页。
- **找**——左侧是类 Google Docs 的大纲，随阅读自动跟随；右侧可选 Sublime 风格的缩略图，顶部和底部的 ↑/↓ 角标显示窗口之外还有多少章，点哪跳哪。整本贴成一篇的长文会按正文里的目录自动切章，切得不合意还能手动调整。
- **记**——点击段落即可加书签（按章节归档）；网文回到上次读的章节和章内位置，单篇回到上次的滚动处；进度按登录账号分开保存，可导出导入换设备。
- **存**——一键导出 EPUB（封面 + 插图，默认 EPUB3、可切 EPUB2，epubcheck 零错误）或 TXT，支持只导出选定的章节范围；也可以经由 [`calibre-bridge`](calibre-bridge/) 直接送进 Calibre-Web-Automated 书库（实验性）。
- **顺手**——纸白 / 护眼 / 夜间 / 跟随系统 / 自定义底色，字号行距页宽字体随心调；界面中文 / English 可切；卷首署名（作者 / 插画 / 翻译 / 图源 / 录入）自动解析进元数据，还可选用 LLM 整理（实验性）；忘了功能怎么用，设置里有 11 步的分步向导。

选章节范围、导出整本：

![下载对话框与章节范围选择器](docs/assets/readme-download.png)

## 安装

1. 装一个油猴管理器：**[Tampermonkey](https://www.tampermonkey.net/)** 或 **[Violentmonkey](https://violentmonkey.github.io/)**。
2. 点 **[📖 安装 / Install](https://raw.githubusercontent.com/Catkamakura/lightnovel-immersive-reader/main/lightnovel-immersive-reader.user.js)**，管理器会直接弹出安装页；或把 [`lightnovel-immersive-reader.user.js`](lightnovel-immersive-reader.user.js) 的内容粘进一个新脚本。
3. 打开 `https://www.lightnovel.fun/` 的任意页面即可使用，之后脚本会随仓库自动更新。

## 快速使用

- 在**详情页或列表页**点 **📖 沉浸阅读**（列表页每张卡片上有一个小 **📖**）。
- 鼠标移到**左上角**，控制按钮会浮现出来：**☰** 大纲 / 目录，**⤓** 下载整本（足够长的书才出现），**⚙** 阅读设置与功能向导。
- 点右下角 **✕ 退出** 或按 **Esc** 离开——网站会停在你正读的那一章，页面与进度自然衔接。

## 可选：发送到 Calibre 书库

阅读器可以把你刚读的 EPUB 经由 [`calibre-bridge/`](calibre-bridge/) 这个 FastAPI 配套服务 POST 进指定的 **Calibre-Web-Automated (CWA)** 书库。

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
├── verify/                               # headless 校验脚本 + README 截图脚本
├── _demo/                                # 演示视频生成流水线（解说 → TTS → 录制 → 合成）
├── docs/                                 # 文档 wiki + 截图 / 视频素材（assets/）
├── AGENTS.md                             # 给 AI 编码 agent 的导览
└── CLAUDE.md                             # → 指向 AGENTS.md
```

## 文档

> 以下文档（`docs/*.md` 与 `AGENTS.md`）均为**英文**，面向开发者 / LLM agent。

如果你是 LLM agent，从这里开始：**[`AGENTS.md`](AGENTS.md)**（项目地图、命令、约定、坑）。

[`docs/`](docs/) 下的 wiki：

- [`docs/architecture.md`](docs/architecture.md) — 脚本、网站 API、bridge 如何协作；所有状态存在哪里；阅读模式（stream / 无缝 flow / 分页）。
- [`docs/userscript.md`](docs/userscript.md) — 脚本的开发者 / LLM 参考：`S` 状态、API 助手、分章、渲染（含 §5a 无缝 flow）、导航、缩略图、书签、续读、设置。
- [`docs/metadata.md`](docs/metadata.md) — 元数据流水线与 EPUB OPF 署名映射（规则化 + 可选 LLM、MARC relator 角色、标签兜底）。
- [`docs/lk-web-api.md`](docs/lk-web-api.md) — 本项目所消费的 lightnovel.fun Web API（信封、端点、阅读模型、「文章内无进度」这一发现）。
- [`docs/calibre-bridge.md`](docs/calibre-bridge.md) — bridge：端点、模式、本地 / Docker 运行、部署、测试。
- [`docs/development.md`](docs/development.md) — 如何开发与校验；约定与坑。
- [`calibre-bridge/README.md`](calibre-bridge/README.md) — bridge 自己的快速开始 + 远程 / Tailscale 部署。

## 开发 / 校验

阅读器是单个原生 JS 文件，无构建步骤。校验通过 Playwright 在 headless 下运行：

```bash
npx playwright install chromium    # 一次性：装浏览器
npm run verify                     # verify-userscript.mjs（32 项）
npm run verify:webnovel            # 网文无缝滚动 + 分页回退（12 项）
npm run verify:lib                 # 发送到书库路径
```

bridge 有自己的 Python 测试（在 `calibre-bridge/` 内 `uv run pytest`）。

## 许可证

[MIT](LICENSE) © masiro
