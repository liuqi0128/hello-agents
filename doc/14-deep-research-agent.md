# 第十四章 自动化深度研究智能体：Node.js 实践

对应原教程：`docs/chapter14/第十四章 自动化深度研究智能体.md`。深度研究的产物不是模型的一段长回答，而是带可追溯来源的报告。核心流程为：规划 TODO -> 搜集证据 -> 逐项综合 -> 质量检查 -> 生成报告。

## 14.1 TODO 驱动的状态模型

把任务写成可恢复的结构化状态，而不是只维护聊天历史：

```js
import { z } from "zod";

export const taskSchema = z.object({
  id: z.string().uuid(), title: z.string(), query: z.string(),
  status: z.enum(["pending", "researching", "completed", "blocked"]),
  findings: z.array(z.string()).default([]), sourceIds: z.array(z.string()).default([]),
});
export const sourceSchema = z.object({
  id: z.string().uuid(), title: z.string(), url: z.string().url(),
  excerpt: z.string(), retrievedAt: z.string().datetime(),
});
```

计划 Agent 应返回经 `taskSchema.array()` 校验的 3 至 8 个任务。若模型返回自由文本或计划过大，拒绝并要求重新生成；不要用正则从任意文本“猜” JSON。

## 14.2 研究循环

以下伪实现强调依赖关系。`search` 应使用具备来源 URL 的搜索服务，`summarize` 必须只根据传入的证据生成结论：

```js
export async function researchTask(task, { search, summarize, saveSource }) {
  const results = await search(task.query, { limit: 5 });
  const sources = await Promise.all(results.map(saveSource));
  const evidence = sources.map((s, index) => `[${index + 1}] ${s.title}\n${s.excerpt}\n${s.url}`).join("\n\n");
  const finding = await summarize({
    question: task.query, evidence,
    instruction: "仅依据证据总结；每项事实标明 [编号]；证据不足时写明未知。",
  });
  return { ...task, status: "completed", findings: [finding], sourceIds: sources.map((s) => s.id) };
}
```

搜索网页是外部不可信输入。页面中的文本既不能改变系统规则，也不能触发下载、登录、付款或执行命令。研究系统应限制域名、请求次数、内容长度和并发量。

## 14.3 报告生成与引用检查

在生成最终报告前，验证每个已完成任务都有来源，且来源 URL 没有重复或不可信域名。报告使用清楚的章节与引用列表：

```js
export function renderReport({ topic, tasks, sources }) {
  const sections = tasks.map((task) => `## ${task.title}\n${task.findings.join("\n")}`).join("\n\n");
  const bibliography = sources.map((s, i) => `${i + 1}. [${s.title}](${s.url})，访问于 ${s.retrievedAt}`).join("\n");
  return `# ${topic}\n\n${sections}\n\n## 参考来源\n${bibliography}`;
}
```

质量检查要分开评估覆盖率（TODO 是否完成）、引文完整率（陈述是否有来源）、来源质量（一级资料优先）、冲突处理和时效性。不能以“模型说它查过了”为依据。

## 14.4 练习

1. 让计划器区分事实问题、比较问题和观点问题，设计不同的检索策略。
2. 为来源增加域名、作者、发布日期与可信度等级。
3. 实现一个任务在三次搜索无证据后标记为 `blocked` 的策略。
4. 在报告中区分“事实”“推断”和“待验证事项”。
