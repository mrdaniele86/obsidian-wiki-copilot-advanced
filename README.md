# Wiki Copilot

Wiki Copilot 是一个面向 **persistent LLM Wiki** 的 Obsidian 问答插件。它不是把整个 Vault 当作一堆同质文本，而是理解以下知识角色：

- Schema：`AGENTS.md`、`CLAUDE.md` 等知识库规则
- Index：内容导航入口
- Wiki：Topic、Concept、Summary 和其他综合页面
- Stable source：已经 ingest、可稳定引用的原始资料 Markdown
- Pending source：尚未验收的资料，默认不参与回答

插件当前采用纯本地词法检索，不使用 embedding。只有最终选中的上下文片段会被发送给用户配置的 OpenAI-compatible 模型服务。

## 当前能力

- 根据 Schema 和目录约定自动识别知识库结构
- 使用 MiniSearch 建立字段加权索引
- 使用 `Intl.Segmenter` 加 CJK fallback 处理中文、日文、韩文
- 保留技术标识符、路径、驼峰词和复合词的检索变体
- 将型号、文档号等字母数字标识符作为精确锚点，避免通用词召回其他系列
- 对“所有 / 全部 / 列出 / 清单”类问题自动扩大同一文档族的候选范围
- 按 Markdown 标题分块，保留章节定位
- Wiki 优先检索，并为 Topic / Concept / Summary 分配独立配额
- 使用出链与反向链接进行 Wikilink 一跳扩展
- 根据 Summary 中的来源路径按需回查稳定原文
- 对超大原文做查询相关章节抽取，避免把整份标准长期留在手机内存
- 待处理资料默认隔离，不作为稳定回答证据
- 回答使用 `[S1]` 等来源标记，并在界面中渲染为可点击的 Obsidian 内链
- API 密钥保存在 Obsidian Secret Storage 中
- 不依赖 Node.js、Electron、本地服务或原生数据库，`isDesktopOnly` 为 `false`

## 检索流程

```text
问题
  │
  ├─► Index / Topic / Concept / Summary / Wiki 全文索引
  │       │
  │       ├─► 字段加权词法检索
  │       └─► Wikilink 一跳扩展（枢纽页降权）
  │
  └─► Stable source 轻量目录
          │
          ├─► Summary 的来源路径
          ├─► Wiki ↔ raw Wikilink
          └─► 文件名 / 标题 / 路径命中
                  │
                  └─► 按需读取少量原文并抽取相关章节
```

这种设计针对手机进行了取舍：启动时完整索引较小且高价值的 Wiki 层，但不会一次性把所有 raw 正文复制到内存。它依赖 LLM Wiki 的核心前提——稳定来源应经过 ingest，并由 Summary 或其他 Wiki 页面建立来源指针。

## 安装与使用

要求 Obsidian 1.11.4 或更新版本。

手动安装时，将以下文件复制到 Vault 的 `.obsidian/plugins/wiki-copilot/`：

- `main.js`
- `manifest.json`
- `styles.css`

然后在 Obsidian 的 Community plugins 中启用 **Wiki Copilot**。

首次使用：

1. 打开 Wiki Copilot 设置。
2. 选择 DeepSeek、OpenAI 或其他 OpenAI 兼容服务。
3. 选择模型并直接填写 API Key；无鉴权的自定义本地服务可以留空。
4. 从侧栏按钮或命令面板打开 Wiki Copilot。

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

- 本地索引不离开 Vault。
- 发送给模型的内容仅限当前问题选中的片段、问题和短期会话历史。
- raw 和 Wiki 内容被视为不可信数据；系统提示明确要求模型忽略来源中夹带的指令。
- API Key 保存在 Obsidian Secret Storage 的插件专用槽位中，不写入插件 `data.json`。
- 插件首版是只读的，不自动修改 Wiki 或 raw。

## 当前限制

- 没有 embedding 或语义向量召回；同义词能力主要来自已维护的 Wiki、别名、标题和链接网络。
- raw 的默认检索是分层按需模式。若某份原文尚未 ingest、没有 Wiki 来源指针，且文件名/标题也不含查询词，它可能不会被召回。
- 会话暂时只保存在当前侧栏实例中，重载插件后不会恢复。
- 当前使用非流式 OpenAI-compatible Chat Completions 请求。
- 首版不自动把高质量回答写回 Wiki。

## Roadmap

### 下一步：流式输出

- 使用 OpenAI-compatible 流式响应，逐步显示模型回答，缩短首次内容出现前的等待时间。
- 支持中止当前回答，并完善流式 Markdown、错误恢复和超时处理。
- 对不支持流式响应的服务保留非流式兼容模式。

### 后续：Embedding 混合检索

- 增加可选的 Embedding 语义召回，用于补充同义表达和关键词不重合的内容。
- 保留现有关键词、技术标识符、Wikilink 和 Wiki 分层检索，并与向量结果融合排序。
- 优先考虑移动端的索引体积、构建耗时、缓存恢复和服务配置体验。

## 开发

```bash
pnpm install
pnpm test
pnpm build
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
