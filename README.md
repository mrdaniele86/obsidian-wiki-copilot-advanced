# Wiki Copilot

Wiki Copilot is an Obsidian question-answering plugin for **persistent LLM Wikis**. It treats a vault as a structured knowledge system instead of a flat collection of interchangeable chunks: schema files describe the local conventions, Wiki pages provide curated knowledge, and source Markdown provides traceable evidence.

When a model is configured, both retrieval modes first ask it for bounded lexical search phrases while always retaining the original question. Fast retrieval uses 3–6 variants over the curated Wiki index with MiniSearch and Wikilink expansion; precise retrieval uses 4–10 variants, then cooperatively checks every eligible Markdown body and extracts only the highest-relevance sections. No embedding service is required. The planner receives the resolved question and a bounded recent conversation window, never Vault bodies; only passages selected for the current question are sent to the answer model.

## Features

- Automatically detects Schema, Index, Topic, Concept, Summary, stable-source, and pending-source roles.
- Fast mode merges a small set of model-planned lexical searches over curated Index, Topic, Concept, Summary, and Wiki fragments only.
- Precise mode uses a broader query plan and scans every eligible Markdown body, including source Markdown from all configured source directories.
- Preserves model numbers, document IDs, paths, compound terms, and camel-case identifiers during lexical retrieval.
- Expands related notes through outgoing links and backlinks while reducing the influence of hub pages.
- Falls back to a bounded, query-time lexical scan on mobile when the device-local index has no result, then routes recovered notes through the normal ranking and citation pipeline.
- Provides a recommended precise full-Markdown scan plus a fast curated-Wiki-only mode.
- Renders traceable citations that open the exact Obsidian note and heading.
- Provides an index diagnostics command for comparing Obsidian-visible files with device-indexed Wiki and source coverage.
- Streams OpenAI-compatible answers with cancellation, incremental Markdown rendering, and a non-streaming compatibility mode.
- Stores API keys in Obsidian Secret Storage instead of plugin settings files.
- Avoids Node.js, Electron-only APIs, native databases, and local helper services; `isDesktopOnly` is `false`.

## Installation

Wiki Copilot requires Obsidian 1.13.0 or later. For manual installation, copy `main.js`, `manifest.json`, and `styles.css` into `<vault-config-dir>/plugins/wiki-copilot/`, then enable **Wiki Copilot** under Community plugins.

Choose DeepSeek, OpenAI, or another OpenAI-compatible service in the plugin settings. Without a configured model, the Send button returns local retrieval results; with a configured model, it generates an answer with citations.

## Privacy and vault access

- Index data is never sent to the model provider. Mobile builds use device-local IndexedDB and do not read the desktop JSON cache that may be present in an iCloud vault; desktop builds currently use the vault configuration directory.
- With a configured model, query planning sends the resolved question plus at most four recent conversation turns: fast mode requests 3–6 variants and precise mode requests 4–10. Planning failure safely falls back to the original question.
- Fast mode reads from the persistent curated-Wiki index. Precise mode reads each eligible Markdown body cooperatively for the current question, retains only lightweight file candidates during the scan, and then extracts a bounded set of relevant sections.
- Stable and pending source directories remain internal indexing roles. Precise mode presents matching passages uniformly as source evidence; fast mode excludes all source bodies.
- Source text is treated as untrusted data; model instructions explicitly tell the model to ignore instructions embedded in retrieved notes.
- Wiki Copilot does not automatically modify Wiki or source notes in the current release.

## Roadmap

1. Add an explicit **refine and save** workflow that turns a high-quality Q&A result into a reviewable Wiki draft, preserves its evidence links, and writes it only after user confirmation.
2. Add optional embedding-based hybrid retrieval while preserving the existing lexical, exact-identifier, Wikilink, and layered-Wiki retrieval paths.

Mobile reliability, streaming compatibility, and citation behavior remain release acceptance criteria rather than separate feature roadmap items.

## 中文说明

Wiki Copilot 是一个面向 **persistent LLM Wiki** 的 Obsidian 问答插件。它不是把整个 Vault 当作一堆同质文本，而是理解以下知识角色：

- Schema：`AGENTS.md`、`CLAUDE.md` 等知识库规则
- Index：内容导航入口
- Wiki：Topic、Concept、Summary 和其他综合页面
- Source：Stable 与 Pending 仍作为内部目录角色识别；问答界面与模型上下文统一呈现为“原文”，不显示状态差异

插件当前采用词法检索，不使用 embedding。配置模型后，检索词规划只发送结合明确追问关系后的当前问题和最多 4 条近期对话，不发送知识库正文；最终回答阶段只发送本轮选中的上下文片段、问题和最多 10 条近期对话。

## 当前能力

- 根据 Schema 和目录约定自动识别知识库结构
- 使用 MiniSearch 建立字段加权索引
- 提供“精准（推荐）”与“快速”两种检索模式；两者都由模型生成检索词，快速模式使用 3–6 条变体搜索整理好的 Wiki 片段，精准模式使用 4–10 条变体扫描全部可检索 Markdown 正文
- 使用 `Intl.Segmenter` 加 CJK fallback 处理中文、日文、韩文
- 保留技术标识符、路径、驼峰词和复合词的检索变体
- 将型号、文档号等字母数字标识符作为精确锚点，避免通用词召回其他系列
- 对“所有 / 全部 / 列出 / 清单”类问题自动扩大同一文档族的候选范围
- 按 Markdown 标题分块，保留章节定位
- Wiki 优先检索，并为 Topic / Concept / Summary 分配独立配额
- 使用出链与反向链接进行 Wikilink 一跳扩展
- 精准模式首轮逐份检查正文但只保留轻量候选，第二轮才从高相关文件中提取 Markdown 章节，避免把全库正文同时留在手机内存
- 手机设备索引无结果时，在严格文件数与字节预算内直接检查本机路径、Metadata Cache 和缺失的 Wiki 页面，再回到统一检索与引用流程
- 精准模式统一检索配置范围内的原文，不向回答模型或来源卡片暴露 Stable/Pending 状态差异
- 回答使用 `[S1]` 等来源标记，并在界面中渲染为可点击的 Obsidian 内链
- 支持 OpenAI-compatible SSE 流式回答、停止生成、增量 Markdown 渲染和非流式兼容模式
- API 密钥保存在 Obsidian Secret Storage 中
- 命令面板提供“显示知识索引诊断”，可核对手机当前可见文件数、索引覆盖和当前笔记状态
- 不依赖 Node.js、Electron、本地服务或原生数据库，`isDesktopOnly` 为 `false`

## 检索流程

```text
问题
  │
  ├─► 模型生成受约束的检索短语（失败时保留原问题直搜）
  │
  ├─► 快速模式
  │     ├─► 原问题 + 3–6 条检索变体
  │     └─► Index / Topic / Concept / Summary / Wiki 整理片段
  │             ├─► 多查询字段加权词法检索与合并排序
  │             └─► Wiki 内 Wikilink 一跳扩展
  │
  └─► 精准模式
        ├─► 原问题 + 4–10 条检索变体
        ├─► 逐份检查全部可检索 Markdown 正文
        ├─► 保留高相关文件候选并提取相关章节
        └─► 精确标识符过滤、排序和上下文裁剪
```

这种设计让两种模式共享相同的问题理解入口，区别只在搜索范围和深度：快速模式依赖较小且高价值的 Wiki 索引；精准模式接受更长等待，逐份检查 Markdown 正文。扫描过程中不会建立第二份全库正文索引，也不会把全部文件同时留在内存；不同来源目录的命中统一呈现为“原文”。

## 安装与使用

要求 Obsidian 1.13.0 或更新版本。

手动安装时，将以下文件复制到 Vault 的 `.obsidian/plugins/wiki-copilot/`：

- `main.js`
- `manifest.json`
- `styles.css`

然后在 Obsidian 的 Community plugins 中启用 **Wiki Copilot**。

首次使用：

1. 打开 Wiki Copilot 设置。
2. 选择 DeepSeek、OpenAI 或其他 OpenAI 兼容服务。
3. 选择模型并直接填写 API Key；无鉴权的自定义本地服务可以留空。
4. 按需要选择“精准（推荐）”或“快速”检索，再从侧栏按钮或命令面板打开 Wiki Copilot。

未完整配置模型时，直接点击“发送”会返回本地检索结果；配置完成后，同一个按钮会生成带引用的 AI 回答。

## 知识库自动识别

插件面向 Karpathy `llm-wiki` 理念，而不是某一套固定目录。它会综合以下信号自动识别知识层、稳定来源层和待处理层：

- 根目录的 `AGENTS.md`、`CLAUDE.md` 等 Schema 文件
- `wiki`、`knowledge`、`kb` 等常见知识层名称
- `topics`、`concepts`、`summaries` 等知识页角色
- `source`、`sources`、`raw` 等来源层名称
- `processed`、`curated`、`verified`、`pending`、`inbox` 等状态语义
- Schema 中以反引号标出的自定义路径及其文字说明

这些规则属于内部自动策略，无需用户设置。Schema 只指导结构识别和查询规则，不作为事实证据。

## 隐私与安全

- 索引数据不会发送到模型。手机端缓存保存在设备本地 IndexedDB，不再读取可能经 iCloud Vault 同步而来的桌面端 JSON 缓存；桌面端缓存当前仍位于 Vault 配置目录。
- 发送给模型的内容仅限检索规划所需的问题与近期对话，以及最终回答所需的本轮命中片段、问题和近期对话；不会发送整库正文。
- raw 和 Wiki 内容被视为不可信数据；系统提示明确要求模型忽略来源中夹带的指令。
- API Key 保存在 Obsidian Secret Storage 的插件专用槽位中，不写入插件 `data.json`。
- 插件首版是只读的，不自动修改 Wiki 或 raw。

## 当前限制

- 没有 embedding 或语义向量召回；两种模式都依赖当前模型生成受约束的关键词、同义词、缩写和跨语言检索短语，快速模式的最终搜索范围仍仅限本地 Wiki 词法索引。
- 精准模式需要读取全部可检索 Markdown，知识库越大、移动设备存储越慢，等待时间越长；任一模式的检索词生成失败时都会使用原始问题继续搜索。
- 会话暂时只保存在当前侧栏实例中，重载插件后不会恢复。
- 流式请求依赖服务端支持 SSE 与 WebView 跨域访问；不兼容的服务可使用非流式兼容模式。
- 首版不自动把高质量回答写回 Wiki。

## Roadmap

### Todo 1：问答提炼并保存

- 将经过用户确认的高质量问答提炼为可复用的 Wiki 草稿，而不是直接保存聊天原文。
- 保存前提供目标页面、标题、正文和引用预览，允许用户修改或取消；未经确认不得写入知识库。
- 保留回答中的来源引用和证据到结论映射，只写入 Wiki 层，不自动修改 `raw/` 来源。
- 支持新建页面和合并到已有页面，并为覆盖、冲突和重复内容提供明确提示。

### Todo 2：Embedding 混合检索

- 增加可选的 Embedding 语义召回，用于补充同义表达和关键词不重合的内容。
- 保留现有关键词、精确标识符、Wikilink 和 Wiki 分层检索，并与向量结果融合排序。
- 优先考虑移动端的索引体积、构建耗时、缓存恢复、隐私边界和服务配置体验。

### 已完成：流式输出

- 使用 OpenAI-compatible 流式响应逐步显示模型回答，缩短首次内容出现前的等待时间。
- 支持中止当前回答、增量 Markdown、错误恢复和超时处理。
- 对不支持流式响应的服务保留非流式兼容模式，并继续进行 Android / iOS 真机验证。

手机端稳定性、流式兼容和引用行为继续作为每个版本的发布验收项，不再单列为功能 Todo。

## 开发

```bash
pnpm install
pnpm lint
pnpm test
pnpm build
pnpm check
pnpm deploy
```

`pnpm deploy` 默认把构建产物复制到源码同级的 `obsidian/.obsidian/plugins/wiki-copilot/`。如需部署到其他 Vault，可先设置 `WIKI_COPILOT_VAULT_ROOT`：

```powershell
$env:WIKI_COPILOT_VAULT_ROOT = "C:\path\to\vault"
pnpm deploy
```

发布 Community plugin 时，GitHub Release 需要包含 `main.js`、`manifest.json` 和 `styles.css`。

## License

MIT
