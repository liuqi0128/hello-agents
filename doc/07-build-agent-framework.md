# 第七章 构建你的 Agent 框架：Node.js 版

对应原教程：`docs/chapter7/第七章 构建你的智能体框架.md`。本章把前面分散的调用逻辑组织为小型框架。目标不是复刻某个 Python 包，而是建立可替换、可测试的 JavaScript 接口。

## 7.1 框架的边界

一个最小 Agent 框架应负责：消息表示、模型适配、工具注册、运行循环、状态和观测。它不应隐藏安全策略或把所有业务写成“通用 Agent”。业务权限与副作用仍属于应用层。

```text
应用层 -> Agent -> LLM adapter
              |-> Tool registry -> 受限工具
              |-> Memory / context (第八、九章)
```

## 7.2 最小实现

安装 `openai dotenv` 后，将以下代码保存为 `mini-agent.js`。`OpenAIChatModel` 是一个提供商适配器：将来接入其他服务时，保持 `complete(messages, tools)` 的返回契约不变。

```js
import "dotenv/config";
import OpenAI from "openai";

class ToolRegistry {
  #tools = new Map();

  register(definition, handler) {
    const name = definition.function?.name;
    if (!name || this.#tools.has(name)) throw new Error(`无效或重复工具：${name}`);
    this.#tools.set(name, { definition, handler });
  }

  definitions() { return [...this.#tools.values()].map((tool) => tool.definition); }

  async execute(name, rawArguments) {
    const tool = this.#tools.get(name);
    if (!tool) return { error: `工具不在白名单中：${name}` };
    try {
      return await tool.handler(JSON.parse(rawArguments));
    } catch (error) {
      return { error: `工具执行失败：${error.message}` };
    }
  }
}

class OpenAIChatModel {
  constructor({ apiKey, baseURL, model }) {
    this.client = new OpenAI({ apiKey, baseURL: baseURL || undefined });
    this.model = model;
  }
  async complete(messages, tools) {
    const response = await this.client.chat.completions.create({
      model: this.model, messages, tools, tool_choice: "auto", temperature: 0,
    });
    const message = response.choices[0]?.message;
    if (!message) throw new Error("模型未返回消息");
    return message;
  }
}

class FunctionCallAgent {
  constructor({ model, tools, system, maxTurns = 6 }) {
    this.model = model;
    this.tools = tools;
    this.system = system;
    this.maxTurns = maxTurns;
  }

  async run(userInput) {
    const messages = [{ role: "system", content: this.system }, { role: "user", content: userInput }];
    for (let turn = 0; turn < this.maxTurns; turn += 1) {
      const assistant = await this.model.complete(messages, this.tools.definitions());
      messages.push(assistant);
      if (!assistant.tool_calls?.length) return { answer: assistant.content, messages };

      for (const call of assistant.tool_calls) {
        const result = await this.tools.execute(call.function.name, call.function.arguments);
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
    throw new Error("Agent 达到最大轮数，任务被中止");
  }
}

const tools = new ToolRegistry();
tools.register({
  type: "function",
  function: {
    name: "calculator", description: "计算两个数的和。",
    parameters: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] },
  },
}, ({ a, b }) => Number.isFinite(a) && Number.isFinite(b) ? { value: a + b } : { error: "a 与 b 必须是数值" });

const model = new OpenAIChatModel({
  apiKey: process.env.LLM_API_KEY, baseURL: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL,
});
const agent = new FunctionCallAgent({
  model, tools, system: "你是数学助手。计算时必须调用 calculator。",
});
console.log((await agent.run("19.5 加 22.3 等于多少？")).answer);
```

## 7.3 接口设计原则

- `Message` 使用 API 兼容的 `{ role, content, tool_calls }`，避免自定义格式在边界反复转换。
- `Model adapter` 只做传输和响应映射，不包含业务 Prompt。
- `ToolRegistry` 是唯一工具入口：注册时声明 Schema，执行时验证参数、权限和超时。
- Agent 只协调循环；ReAct、Reflection、Plan-and-Execute 可以分别实现为不同 `run` 策略。
- 所有运行都应有 `runId`、最大轮数、预算和结构化事件日志。

本例为突出接口而没有加入 Zod。生产工具应在 `handler` 前使用 Zod/JSON Schema 验证参数；模型提供的 JSON Schema 只能降低错误概率，不能取代服务端校验。

## 7.4 扩展路线

先为 `ToolRegistry.execute` 加入超时和事件钩子，再为 `FunctionCallAgent` 增加 Memory 注入，最后引入第九章的上下文预算。只有在确实需要条件分支、并行或恢复时，再迁移到 LangGraph.js。

## 7.5 练习

1. 为 `ToolRegistry` 写单元测试，覆盖重复注册、未知工具和非法 JSON。
2. 给每次工具调用生成 `runId` 和耗时，设计日志字段。
3. 实现只读 `getUserProfile`，要求调用者传入内部用户 ID，且禁止模型指定任意 ID。
4. 将 Agent 的 `maxTurns` 和模型 token 预算变为可配置的运行策略。
