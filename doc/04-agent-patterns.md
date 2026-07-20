# 第四章 智能体经典范式构建：Node.js 实践

对应原教程：`docs/chapter4/第四章 智能体经典范式构建.md`。

经典 Agent 范式关注的不是“换一个模型”，而是如何组织模型调用、工具和状态。三种常见模式分别解决不同问题：

| 模式 | 适合的问题 | 核心代价 |
| --- | --- | --- |
| ReAct | 下一步取决于刚获得的事实 | 多轮调用与轨迹不稳定 |
| Plan-and-Execute | 可先分解的大型任务 | 计划可能过时，需要重规划 |
| Reflection | 可明确评价、允许迭代改进的产物 | 成本和延迟上升 |

## 4.1 ReAct：推理、行动、观察

ReAct 将任务运行成小循环：模型根据当前观察选择工具，程序执行工具，结果返回模型。第一章已使用 API 的原生工具调用实现过这个循环；下面将其封装为一个通用的 Node.js `runReAct` 函数。

保存为 `react-agent.js`，并按照 README 安装 `openai`、`dotenv`：

```js
import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.LLM_API_KEY,
  baseURL: process.env.LLM_BASE_URL || undefined,
});

const tools = [
  {
    type: "function",
    function: {
      name: "calculate",
      description: "计算两个数的加、减、乘、除。",
      parameters: {
        type: "object",
        properties: {
          a: { type: "number" }, b: { type: "number" },
          operator: { type: "string", enum: ["+", "-", "*", "/"] },
        },
        required: ["a", "b", "operator"], additionalProperties: false,
      },
    },
  },
];

function calculate({ a, b, operator }) {
  if (operator === "/" && b === 0) return { error: "不能除以零" };
  const values = { "+": a + b, "-": a - b, "*": a * b, "/": a / b };
  return { value: values[operator] };
}

async function runReAct({ system, user, maxTurns = 5 }) {
  const messages = [{ role: "system", content: system }, { role: "user", content: user }];
  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const response = await client.chat.completions.create({
      model: process.env.LLM_MODEL, messages, tools, tool_choice: "auto", temperature: 0,
    });
    const message = response.choices[0]?.message;
    if (!message) throw new Error("模型未返回有效消息");
    messages.push(message);

    if (!message.tool_calls?.length) return { answer: message.content, messages };

    for (const call of message.tool_calls) {
      let result;
      try {
        const args = JSON.parse(call.function.arguments);
        result = call.function.name === "calculate"
          ? calculate(args)
          : { error: `不允许调用工具 ${call.function.name}` };
      } catch (error) {
        result = { error: `参数错误：${error.message}` };
      }
      console.log(`第 ${turn} 轮 ${call.function.name}:`, result);
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  throw new Error(`超过最大轮数 ${maxTurns}，已中止以避免失控循环`);
}

const result = await runReAct({
  system: "你是计算助手。涉及数值计算时必须调用 calculate；只根据工具结果作答。",
  user: "(18.5 * 3 - 7) / 2 是多少？",
});
console.log(result.answer);
```

不要将模型生成的工具名直接映射到任意 JavaScript 函数，也不要让它执行 shell 命令。工具应是显式白名单，每个工具独立校验参数、权限、超时和返回结果。

## 4.2 Plan-and-Execute：先分解，再执行

当任务包含多个相对稳定的子目标时，先产生计划可以让执行轨迹更清楚。一个好的执行器不应盲从计划：如果工具结果表明前提错误，应记录原因并允许重新规划。

下面的例子展示状态结构。`createPlan` 和 `executeStep` 是需要接入 LLM/工具的边界，刻意保持为普通函数，方便替换或测试：

```js
const state = {
  goal: "为团队选择一个周末团建方案",
  plan: [],
  completed: [],
  artifacts: [],
};

async function createPlan(goal) {
  // 生产中：要求模型输出经 JSON Schema 校验的数组，而非自由文本。
  return [
    "收集人数、预算、城市和日期约束",
    "查询候选活动与交通信息",
    "按预算、天气和可达性比较候选项",
    "输出方案及需要用户确认的事项",
  ];
}

async function executeStep(step, currentState) {
  // 生产中：此处由受限的 ReAct 子智能体或确定性工作流执行。
  return { step, result: `已完成：${step}`, needsReplan: false, evidence: [] };
}

state.plan = await createPlan(state.goal);
for (const step of state.plan) {
  const outcome = await executeStep(step, state);
  state.completed.push(outcome);
  if (outcome.needsReplan) {
    state.plan = await createPlan(`${state.goal}\n新事实：${outcome.result}`);
    break;
  }
}
console.dir(state, { depth: null });
```

计划适合长期目标，状态则是可靠性的核心。至少保存原始目标、当前计划、已经执行的步骤、工具证据、失败原因和用户确认记录。这样才能恢复任务、审计决策或准确重试。

## 4.3 Reflection：生成、评价、修订

Reflection 不是让模型无限“自我批评”，而是设定可检查的评价标准，并限制迭代次数。以代码摘要为例：

```js
async function reflect({ draft, review }) {
  const score = review.score;
  if (score >= 8) return { done: true, output: draft };
  return {
    done: false,
    revisionInstruction: `请修订草稿，重点解决：${review.issues.join("；")}`,
  };
}

let draft = "该函数会读取配置并返回结果。";
for (let attempt = 0; attempt < 2; attempt += 1) {
  // 实际项目中，review 由测试、lint、规则和 LLM 审查共同产生。
  const review = { score: attempt === 0 ? 6 : 9, issues: ["未说明失败分支", "缺少副作用描述"] };
  const decision = await reflect({ draft, review });
  if (decision.done) break;
  draft = `${draft}\n修订：失败时返回可诊断错误，不写入外部状态。`;
}
console.log(draft);
```

最可靠的评价器通常不是另一个模型，而是单元测试、类型检查、JSON Schema、检索证据覆盖率和业务规则。LLM 评价适合表达质量、完整性等难以形式化的维度，但必须保留输入、标准和评分记录。

## 4.4 选择原则

- 单次工具选择不确定：使用 ReAct，并限制工具和轮数。
- 任务可以拆成可追踪里程碑：使用 Plan-and-Execute，并支持重规划。
- 产物可被明确评价且修订有价值：使用 Reflection，并以固定预算结束。
- 步骤完全稳定：使用确定性工作流，通常比 Agent 更便宜、可预测。

## 4.5 练习

1. 给 ReAct 例子加一个只读的 `get_exchange_rate` 工具，设计对网络失败的响应。
2. 为 `state` 加入 `runId`、开始时间、每步耗时，并输出可审计 JSON。
3. 为代码摘要设计四个可客观检查的 Reflection 标准。
4. 选一个自己的任务，判断它应使用工作流、ReAct 还是 Plan-and-Execute，并说明失败模式。
