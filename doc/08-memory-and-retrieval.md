# 第八章 记忆与检索：Node.js 实践

对应原教程：`docs/chapter8/第八章 记忆与检索.md`。记忆保存“与某个用户或任务相关、未来仍有用”的信息；RAG 从外部知识库检索与当前问题相关的证据。二者都不是把所有历史原文塞入 Prompt。

## 8.1 记忆层次与写入原则

| 类型 | 例子 | 生命周期 |
| --- | --- | --- |
| 工作记忆 | 当前任务的中间结果 | 单次运行 |
| 情景记忆 | 用户上次选择了北京方案 | 跨会话，可过期 |
| 语义记忆 | 用户偏好低糖饮食 | 跨会话，需来源与确认 |
| 外部知识/RAG | 产品手册中的退款规则 | 由文档版本管理 |

仅写入与任务有益、获得授权且可解释的信息。隐私、健康、财务或身份数据要有明确的收集目的、保留期限和删除机制。

## 8.2 一个可测试的内存记忆原型

保存为 `memory-store.js`。它用 token 重叠分数演示“检索”接口，便于零依赖学习；它不是语义向量检索的替代品。

```js
import { pathToFileURL } from "node:url";

function terms(text) {
  return new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}
function overlapScore(query, text) {
  const q = terms(query); const d = terms(text);
  if (!q.size || !d.size) return 0;
  let hits = 0;
  for (const term of q) if (d.has(term)) hits += 1;
  return hits / Math.sqrt(q.size * d.size);
}

export class MemoryStore {
  #items = [];

  add({ content, type = "episodic", importance = 0.5, source = "user" }) {
    const item = { id: crypto.randomUUID(), content, type, importance, source, createdAt: new Date().toISOString() };
    this.#items.push(item);
    return item;
  }

  search(query, { limit = 3, types } = {}) {
    return this.#items
      .filter((item) => !types || types.includes(item.type))
      .map((item) => ({ ...item, score: overlapScore(query, item.content) * 0.8 + item.importance * 0.2 }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  forgetBefore(isoDate) {
    const previous = this.#items.length;
    this.#items = this.#items.filter((item) => item.createdAt >= isoDate || item.importance >= 0.8);
    return previous - this.#items.length;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const memory = new MemoryStore();
  memory.add({ content: "用户小林偏好周末在北京进行室内活动", type: "semantic", importance: 0.9 });
  memory.add({ content: "2026-07-20：用户选择了故宫参观方案", type: "episodic", importance: 0.6 });
  console.log(memory.search("北京周末有什么推荐？"));
}
```

生产系统可保持相同的 `add/search` 接口，将评分层替换成 embeddings + 向量数据库（Qdrant、pgvector 等）。检索记录至少带上 `source`、文档/会话版本、创建时间和权限范围，以便向用户说明“为什么这条信息会被使用”。

## 8.3 最小 RAG 管线

RAG 的基本链路为：文档解析 -> 分块 -> 向量化 -> 索引 -> 检索 -> （可选）重排序 -> 带来源生成。最常见错误是只关心模型回答，忽略分块质量、权限过滤和证据引用。

下面用同一个演示评分器构建知识库，强调 API 形状：

```js
import { MemoryStore } from "./memory-store.js";

const knowledge = new MemoryStore();
[
  "退款申请应在购买后七天内提出，数字内容下载后不支持无理由退款。",
  "企业账户可在管理后台下载月度发票。",
  "客服工作时间为工作日 9:00 至 18:00。",
].forEach((content, index) => knowledge.add({ content, type: "knowledge", importance: 1, source: `policy-v1#${index + 1}` }));

function retrieve(question) {
  return knowledge.search(question, { limit: 2, types: ["knowledge"] });
}

const evidence = retrieve("下载数字内容后还能退款吗？");
const context = evidence.map((item, index) => `[${index + 1}] ${item.content}（${item.source}）`).join("\n");
console.log({ context, instruction: "仅依据以上证据回答；证据不足时明确说明。" });
```

接入 LLM 时，把 `context` 作为受信任的资料片段，而不是系统指令。文档内容可能包含“忽略以上规则”等提示注入文本，必须用清晰分隔符告诉模型：资料是数据，不可改变系统规则。

## 8.4 质量与安全

- 检索前根据用户/租户 ACL 过滤，不能只在生成后隐藏答案。
- 记录被选中的 chunk、分数和文档版本，方便评估召回率与溯源。
- 对长文档按语义边界分块并保留标题、页码和相邻片段；不要盲目固定字符数。
- 分别评估“是否检索到正确证据”和“是否根据证据正确回答”。
- 给记忆设置 TTL、重要性和用户删除入口，避免无期限累积。

## 8.5 练习

1. 为 `MemoryStore` 加入按 `userId` 隔离的命名空间。
2. 用真实 embedding 提供商替换 `overlapScore`，但不改变 `search` 的调用方。
3. 为 RAG 结果增加 `documentId`、页码和引用渲染。
4. 构造一段含指令注入的文档，验证系统 Prompt 仍优先于检索内容。
