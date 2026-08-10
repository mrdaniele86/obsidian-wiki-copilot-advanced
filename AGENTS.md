# Wiki Copilot 开发约定

本文件用于让新的 Codex 会话或另一台电脑快速接续 Wiki Copilot 的开发。开始工作前先阅读本文件、`README.md`、`CHANGELOG.md` 和 `manifest.json`。

## 1. 项目目标

Wiki Copilot 是面向 Karpathy `llm-wiki` 理念的 Obsidian 知识库问答插件。它把 Vault 视为有角色的知识系统，而不是同质文本集合：

- Schema：`AGENTS.md`、`CLAUDE.md` 等本地规则
- Index：知识库入口
- Wiki：Topic、Concept、Summary 等沉淀知识
- Source：Stable source 与 Pending source 仍作为内部目录角色识别，但在问答界面和模型上下文中统一呈现为“原文”，不显示可信度差异或提醒

当前检索以词法方案为主，不使用 Embedding。配置模型后，两种模式都先让当前模型结合最多 4 条近期对话生成受约束的检索短语：快速模式生成 3–6 条变体，只查询已经整理好的 Index、Topic、Concept、Summary 与 Wiki 片段；精准模式生成 4–10 条变体，再逐份检查全部可检索 Markdown 正文并提取高相关章节。规划失败或未配置模型时保留原问题直搜。检索规划只发送问题与受限近期对话，最终回答只发送当前问题选中的片段、问题和最多 10 条近期对话；全库正文不会上传。

## 2. 当前 Roadmap

按以下顺序推进，除非用户明确调整：

1. 增加“问答提炼并保存”：把用户确认的高质量回答整理为可审阅的 Wiki 草稿，保存前允许修改目标、标题和正文，保留来源引用与证据映射；未经确认不得写入，且不得自动修改 `raw/`。
2. 增加可选 Embedding 混合检索；必须保留现有关键词、精确标识符、Wikilink 和 Wiki 分层检索，并融合排序，同时控制移动端索引体积、恢复成本和隐私边界。

移动端稳定性、流式兼容、引用跳转和缓存恢复是每个版本的持续发布验收项，不作为独立功能 Todo。

### 同类实现参考

- [Obsidian Copilot](https://github.com/logancyang/obsidian-copilot)：参考其 query-time lexical candidate scan、临时索引内存预算、增量索引和索引诊断；Wiki Copilot 仍保留自己的 Schema/Wiki/source 分层与确定性精确标识符约束。
- [Smart Connections](https://github.com/brianpetro/obsidian-smart-connections) / [Smart Environment](https://github.com/brianpetro/obsidian-smart-env)：参考其 Vault 文件事件、可检查的来源状态、移动端分片阈值和逐项修复思路；不要直接复制其 embedding 数据模型。
- [Khoj](https://github.com/khoj-ai/khoj)：其统一服务器索引可实现最强跨设备一致性，但会引入上传、自托管和账户依赖；除非用户明确选择服务器路线，否则不作为默认架构。
- 采用同类机制前必须核对其最新源码和许可，并用本项目自己的实现与测试落地，不复制大段源码。

## 3. 目录与关键模块

- `src/main.ts`：插件生命周期、命令、视图激活、问答编排
- `src/settings.ts`：Obsidian 1.13+ 声明式设置
- `src/core/`：分词、分块、检索、Profile 识别、引用和调度
- `src/obsidian/`：Vault 索引协调、缓存、来源目录和临时页面控制
- `src/llm/`：OpenAI-compatible 请求、提示词和超时
- `src/ui/`：聊天视图与交互
- `tests/`：Vitest 回归测试
- `main.js`：构建产物，不直接编辑
- `styles.css`：插件样式
- `scripts/deploy.mjs`：部署到测试 Vault

## 4. 不可破坏的设计约束

- `isDesktopOnly` 必须保持 `false`；禁止依赖 Node.js、Electron、原生数据库或常驻本地服务。
- 移动端兼容优先。不要使用正则后行断言等旧版 iOS WebKit 不支持的语法。
- 弹出窗口兼容：界面定时器使用对应窗口的 `window` / `activeWindow`，不要使用 `globalThis` 或裸 `setTimeout()`。
- Vault 配置目录必须读取 `Vault.configDir`，不得假定为 `.obsidian`。
- 设置页使用 Obsidian 声明式 `getSettingDefinitions()` API 和原生 `Setting` 组件。
- 避免 CSS `!important`；通过局部作用域、选择器特异性或 CSS 变量解决覆盖问题。
- CPU 密集索引必须分片并主动让出主线程，避免检索期间阻塞滚动、展开来源或点击。
- 启动优先恢复索引快照并增量同步。不得让正常文件事件触发无限完整重建。
- Stable/Pending 来源角色只用于内部索引和文件管理，不向模型或问答界面暴露状态差异。Schema 只指导结构与检索，不作为事实证据。
- API key 只保存在 Obsidian Secret Storage，不写入 `data.json`、日志、测试或仓库。
- 回答引用必须能追溯到具体页面与标题，并保持手机端可点击。

## 5. 开发与验证

要求 Node.js、pnpm。首次运行：

```bash
pnpm install
```

常用命令：

```bash
pnpm lint
pnpm test
pnpm build
pnpm check
pnpm deploy
```

`pnpm check` 会依次执行 Obsidian 官方 ESLint 规则、Vitest 和生产构建。每次功能或修复至少执行该命令。涉及 UI、索引、缓存、移动端兼容或引用打开时，还应在真实 Obsidian 中做对应冒烟测试。不要只以 TypeScript 编译成功作为完成标准。

部署到自定义 Vault：

```powershell
$env:WIKI_COPILOT_VAULT_ROOT = "C:\path\to\vault"
pnpm deploy
```

## 6. 版本与发布

公开版本必须使用三段式 SemVer，例如 `1.0.1`，不能使用 `1.0`。发版时同步更新：

- `package.json`
- `manifest.json`
- `versions.json`
- `CHANGELOG.md`

发布流程：

1. 确认工作区只包含本次范围内的修改。
2. 运行 `pnpm check`，必要时运行 `pnpm deploy` 做 Obsidian 冒烟测试。
3. 提交并推送到 `main`。
4. 创建与 `manifest.json` 版本完全一致的 Git tag 和 GitHub Release。
5. Release 必须附带 `main.js`、`manifest.json`、`styles.css`。
6. 在 Obsidian Community 插件后台确认新版本已识别并通过自动检查。

远程仓库当前为 `https://github.com/deanxizian/obsidian-wiki-copilot`；本地项目目录与远程仓库统一使用 `obsidian-wiki-copilot`。

## 7. 修改原则

- 使用小而可验证的改动，并为修复补回归测试。
- 保留用户未授权范围内的现有行为与本地改动。
- 不直接修改生成的 `main.js`；修改 `src/` 后重新构建。
- 不提交 API key、Vault 私有内容、索引缓存、插件 `data.json` 或临时文件。
- 改动检索排序时，同时验证精确型号、文档号、中文查询、枚举型问题和普通自然语言问题。
- 改动索引生命周期时，同时验证首次构建、缓存恢复、增量更新、手动重建和重启 Obsidian。
