# 第六章 框架开发实践：JavaScript 生态

对应原教程：`docs/chapter6/第六章 框架开发实践.md`。原教程的 AutoGen、AgentScope、CAMEL 示例均以 Python 为主。本章保留“多智能体协作”和“图式控制流”的核心思想，使用 Node.js 生态中更贴近的 LangChain.js/LangGraph.js 实现。

## 6.1 为什么使用框架

手写循环适合学习和小型任务；框架在任务需要状态、条件路由、重试、检查点和人工介入时更有价值。框架不替代工程判断，尤其不替代工具权限、数据隔离、成本预算和测试。

| 需求 | 轻量选择 | 适合使用框架 |
| --- | --- | --- |
| 单次结构化提取 | SDK + Zod | 无需 Agent 框架 |
| 单 Agent 工具循环 | 第一章的手写循环 | 工具/状态少时足够 |
| 多步骤、有条件分支 | LangGraph.js | 需要状态图、恢复、可视化 |
| 多角色协作 | 显式角色函数 + 状态图 | 角色交接、审批、并行需要受控 |

## 6.2 用 LangGraph.js 构建工具 Agent

安装依赖：

```bash
npm install @langchain/langgraph @langchain/openai @langchain/core zod dotenv
```

以下例子定义了模型节点和工具节点。图在模型决定调用工具时转向 `tools`，否则结束。这是 ReAct 循环在图模型中的表达。

```js
import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { END, START, MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";

const weather = tool(
  async ({ city }) => JSON.stringify({ city, condition: "晴", temperatureC: 26 }),
  {
    name: "weather",
    description: "读取指定城市的演示天气。",
    schema: z.object({ city: z.string().describe("城市名称") }),
  },
);
const tools = [weather];
const model = new ChatOpenAI({ model: process.env.LLM_MODEL, temperature: 0 })
  .bindTools(tools);

async function callModel(state) {
  const response = await model.invoke(state.messages);
  return { messages: [response] };
}

function route(state) {
  const last = state.messages.at(-1);
  return last.tool_calls?.length ? "tools" : END;
}

const app = new StateGraph(MessagesAnnotation)
  .addNode("agent", callModel)
  .addNode("tools", new ToolNode(tools))
  .addEdge(START, "agent")
  .addConditionalEdges("agent", route, ["tools", END])
  .addEdge("tools", "agent")
  .compile();

const finalState = await app.invoke({
  messages: [{ role: "user", content: "北京天气如何？给一句出行建议。" }],
});
console.log(finalState.messages.at(-1).content);
```

`ChatOpenAI` 默认使用 OpenAI 连接配置。若使用兼容服务，请先确认该服务与所安装版本的 `@langchain/openai` 配置方式兼容；不兼容时保留第一章的原生 SDK 客户端即可。不要为了“使用框架”而增加一层不必要的抽象。

## 6.3 多角色协作不等于多个无限循环

多 Agent 的价值来自分工和交接契约，不是创建更多聊天窗口。下面是一个软件需求评审的受控模式：每个角色只产生结构化产物，协调者依据状态决定下一个角色。

```js
const state = {
  requirement: "为团队实现带权限控制的文档搜索",
  artifacts: { analysis: null, design: null, review: null },
};

async function analyst(requirement) {
  return { assumptions: ["已有身份服务"], acceptanceCriteria: ["无权限用户不能看到文档标题"] };
}
async function architect(analysis) {
  return { design: "检索前按租户和 ACL 过滤；结果携带来源与权限证明", risks: ["索引延迟"] };
}
async function reviewer(design) {
  return { approved: true, findings: [], checked: design.design };
}

state.artifacts.analysis = await analyst(state.requirement);
state.artifacts.design = await architect(state.artifacts.analysis);
state.artifacts.review = await reviewer(state.artifacts.design);
console.dir(state, { depth: null });
```

真实项目中可将上述函数替换为不同的模型提示，但必须使用 Zod/JSON Schema 验证输入和输出，并限制角色能访问的工具。把最终执行权保留给一个明确的审批节点。

## 6.4 框架选择与测试

选择框架前用一个真实任务验证四件事：状态如何持久化、失败如何恢复、工具调用如何审计、版本升级如何回归测试。至少测试以下情形：工具超时、模型返回无效参数、重复事件、用户中断、预算耗尽和检查点恢复。

对于图式 Agent，最有价值的测试往往不调用模型：给节点注入固定的状态和伪造工具结果，断言路由和最终状态。这样测试快、稳定，也能覆盖真正的业务规则。

## 6.5 练习

1. 在 LangGraph 示例中加一个 `calculator` 工具，并为除零返回结构化错误。
2. 将天气工具替换为真实 API，为节点加入超时和重试策略。
3. 为多角色示例加一个安全审查角色，若出现“未定义权限模型”则路由回架构师。
4. 列出你的 Agent 状态中哪些字段可以持久化，哪些字段不得写入日志。
