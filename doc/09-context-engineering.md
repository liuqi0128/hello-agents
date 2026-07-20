# 第九章 上下文工程：Node.js 实践

对应原教程：`docs/chapter9/第九章 上下文工程.md`。上下文工程是以有限 token 预算，组装让模型能完成当前任务的最小充分信息。它包括选择、压缩、排序、隔离和持续更新，而不只是写更长的 Prompt。

## 9.1 上下文包

一次 Agent 调用常见的上下文来源有系统规则、用户目标、近期对话、检索证据、记忆、工具结果和任务笔记。建议将它们结构化为 `ContextPacket`，并为每一类分配预算：

```text
系统规则（固定且最高优先级）
当前目标与约束
最近对话（短期状态）
检索证据 / 长期记忆（按相关性选择）
任务笔记（计划、决策、阻塞点）
```

“更多上下文”不总是更好：无关片段会稀释关键信息，过长历史会提高成本并引入已失效的指令。

## 9.2 构建带预算的 ContextBuilder

下面的实现按优先级和字符预算（教学近似）选择片段。生产版本应使用目标模型的 tokenizer 计算 token 数，而不是字符数。

```js
export class ContextBuilder {
  constructor({ maxChars = 6_000 } = {}) { this.maxChars = maxChars; }

  build({ goal, recentMessages = [], memories = [], evidence = [], notes = [] }) {
    const sections = [
      { label: "当前目标", priority: 100, text: goal },
      ...recentMessages.map((m) => ({ label: `对话:${m.role}`, priority: 90, text: m.content })),
      ...notes.map((n) => ({ label: `笔记:${n.type}`, priority: 80 + (n.priority ?? 0), text: n.content })),
      ...evidence.map((e) => ({ label: `证据:${e.source}`, priority: 70 + (e.score ?? 0), text: e.content })),
      ...memories.map((m) => ({ label: `记忆:${m.type}`, priority: 50 + (m.score ?? 0), text: m.content })),
    ].sort((a, b) => b.priority - a.priority);

    const selected = [];
    let used = 0;
    for (const section of sections) {
      const text = section.text.trim();
      if (!text || used + text.length > this.maxChars) continue;
      selected.push(section);
      used += text.length;
    }
    return { selected, usedChars: used, text: selected.map((s) => `## ${s.label}\n${s.text}`).join("\n\n") };
  }
}

const builder = new ContextBuilder({ maxChars: 800 });
console.log(builder.build({
  goal: "回答退款政策问题，只引用已检索证据。",
  recentMessages: [{ role: "user", content: "数字内容下载后能退款吗？" }],
  evidence: [{ source: "policy-v1#1", score: 0.95, content: "数字内容下载后不支持无理由退款。" }],
  notes: [{ type: "constraint", priority: 10, content: "无法确认时不要猜测。" }],
}));
```

被截掉的高价值内容不应悄悄丢失。可以先保存进结构化笔记，或生成可追溯的摘要，再在下一次调用按需取回。

## 9.3 结构化笔记

笔记是长时程任务的外部状态，不是完整聊天记录。用明确类型保存决策、待办、阻塞与证据，便于检索、展示和恢复：

```js
export class NoteStore {
  #notes = [];
  add({ type, content, priority = 0, status = "open" }) {
    const note = { id: crypto.randomUUID(), type, content, priority, status, updatedAt: new Date().toISOString() };
    this.#notes.push(note); return note;
  }
  listOpen() { return this.#notes.filter((note) => note.status === "open"); }
  close(id) {
    const note = this.#notes.find((item) => item.id === id);
    if (note) { note.status = "closed"; note.updatedAt = new Date().toISOString(); }
    return note;
  }
}

const notes = new NoteStore();
notes.add({ type: "decision", content: "退款回答必须带政策版本", priority: 10 });
notes.add({ type: "blocker", content: "尚未确认企业账户的退款例外" });
console.log(notes.listOpen());
```

## 9.4 只读工作区探索

不要把通用 shell 交给模型。大多数代码库探索可由受限文件 API 完成：限制根目录、禁止路径逃逸、限制文件大小和扩展名。以下工具只列出目录和读取工作区内的文本文件：

```js
import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";

export function safePath(root, requested) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, requested);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("路径超出允许的工作区");
  }
  return target;
}

export async function listWorkspace(root, requested = ".") {
  return readdir(safePath(root, requested), { withFileTypes: true })
    .then((items) => items.slice(0, 100).map((item) => ({ name: item.name, kind: item.isDirectory() ? "directory" : "file" })));
}

export async function readWorkspaceText(root, requested) {
  const target = safePath(root, requested);
  if ((await stat(target)).size > 50_000) throw new Error("文件超过 50KB 读取上限");
  return readFile(target, "utf8");
}
```

再将目录、摘要和关键文件片段送入 `ContextBuilder`。写文件、运行命令或发起网络请求必须是独立工具，并分别要求权限、参数验证和用户确认。

## 9.5 练习

1. 使用真实 tokenizer 替换 `maxChars` 近似，验证不会超过模型上下文窗口。
2. 为 ContextBuilder 加入“永远保留当前目标与安全约束”的保留预算。
3. 将笔记持久化为 JSON，并实现按 `status`、`type` 查询。
4. 为只读工作区工具补充符号链接检查、文件扩展名白名单和审计日志。
