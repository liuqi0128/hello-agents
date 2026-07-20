# 第一章 初识智能体：Node.js 实践

对应原教程：`docs/chapter1/第一章 初识智能体.md`。

本章先建立一个工作定义：**智能体是一个能感知环境、根据目标做决策，并通过行动改变环境的系统。** 对 LLM Agent 而言，用户消息和工具返回值是感知，模型推理与工具选择是决策，调用 API、写入文件或发送请求是行动。

## 1.1 智能体的基本闭环

一个最小闭环可表示为：

```text
目标 -> 感知 Observation -> 决策 Thought/Tool call -> 行动 Action
  ^                                                    |
  +---------------- 新的 Observation <----------------+
```

传统智能体常以规则、状态机、搜索或效用函数作决策；LLM Agent 则把自然语言理解、任务分解和工具选择交给模型。模型本身不等于 Agent：没有环境、工具和循环的聊天补全只是一次文本生成。

设计任务环境时，可用 **PEAS** 检查遗漏：

| 维度 | 旅行助手示例 |
| --- | --- |
| Performance measure（评价） | 信息正确、建议合适、成本和延迟可接受 |
| Environment（环境） | 用户、天气服务、景点信息 |
| Actuators（执行器） | 调用天气/推荐工具、返回回答 |
| Sensors（传感器） | 用户文字、API 返回值、历史消息 |

## 1.2 5 分钟实现第一个工具调用 Agent

下面的旅行助手与原教程的任务一致：先查询北京天气，再按天气推荐景点。与手写 `Thought: ... Action: ...` 字符串不同，示例使用 API 原生的 **function calling**。这样参数由 JSON Schema 约束，程序不需要用正则解析模型输出。

### 准备

新建一个目录，安装依赖，并写入上面 README 中的 `.env`：

```bash
npm init -y
npm pkg set type=module
npm install openai dotenv
```

将以下内容保存为 `travel-agent.js`。天气工具调用公开的 `wttr.in`，适合学习而非生产 SLA；景点工具使用了本地演示数据，因此无需额外搜索 Key。

```js
import "dotenv/config";
import OpenAI from "openai";

const apiKey = (process.env.LLM_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? "").trim();
const model = (process.env.LLM_MODEL ?? "").trim();
if (!apiKey || !model) {
  throw new Error("请在 .env 中设置 LLM_API_KEY（或 DEEPSEEK_API_KEY）和 LLM_MODEL，且不要留空白值。");
}

const client = new OpenAI({
  apiKey,
  baseURL: process.env.LLM_BASE_URL?.trim() || undefined,
});

async function getWeather({ city }) {
  const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const current = data.current_condition?.[0];
    if (!current) throw new Error("响应中没有当前天气");

    return {
      city,
      condition: current.weatherDesc?.[0]?.value ?? "未知",
      temperatureC: Number(current.temp_C),
      humidity: Number(current.humidity),
    };
  } catch (error) {
    return { city, error: `查询天气失败：${error.message}` };
  }
}

function getAttraction({ city, weather }) {
  const suggestions = {
    北京: {
      rain: "故宫博物院、国家博物馆等室内场馆",
      default: "颐和园、天坛公园或长城（注意防晒和交通时间）",
    },
  };
  const entry = suggestions[city] ?? {
    rain: "当地博物馆、美术馆或大型室内展馆",
    default: "当地公园、历史街区或城市地标",
  };
  const rainy = /rain|雨|雷暴/i.test(weather);
  return { city, weather, recommendation: rainy ? entry.rain : entry.default };
}

const tools = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "查询一个城市当前天气。涉及实时天气时必须先调用它。",
      parameters: {
        type: "object",
        properties: { city: { type: "string", description: "城市名称，例如 北京" } },
        required: ["city"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_attraction",
      description: "根据城市和天气给出旅游景点建议。必须在已得到天气后调用。",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string" },
          weather: { type: "string", description: "get_weather 返回的 condition" },
        },
        required: ["city", "weather"],
        additionalProperties: false,
      },
    },
  },
];

const implementations = { get_weather: getWeather, get_attraction: getAttraction };
const messages = [
  {
    role: "system",
    content: "你是可靠的旅行助手。根据工具结果回答；不要编造实时天气。工具发生错误时，如实说明。",
  },
  {
    role: "user",
    content: "请查询今天北京的天气，并据此推荐一个合适的旅游景点。",
  },
];

for (let turn = 0; turn < 6; turn += 1) {
  const completion = await client.chat.completions.create({
    model,
    messages,
    tools,
    tool_choice: "auto",
    temperature: 0.2,
  });
  const assistant = completion.choices[0]?.message;
  if (!assistant) throw new Error("模型没有返回消息");
  messages.push(assistant);

  if (!assistant.tool_calls?.length) {
    console.log(`\n最终回答：\n${assistant.content}`);
    break;
  }

  for (const call of assistant.tool_calls) {
    if (call.type !== "function") continue;
    const run = implementations[call.function.name];
    let result;
    try {
      const args = JSON.parse(call.function.arguments);
      result = run ? await run(args) : { error: `未知工具：${call.function.name}` };
    } catch (error) {
      result = { error: `工具参数无效：${error.message}` };
    }
    console.log(`[工具] ${call.function.name}:`, result);
    messages.push({
      role: "tool",
      tool_call_id: call.id,
      content: JSON.stringify(result),
    });
  }
}
```

运行：

```bash
node travel-agent.js
```

### 循环发生了什么

1. 模型看见用户目标及两个工具的契约。
2. 它选择 `get_weather`，程序执行真实 HTTP 请求，并将 JSON 作为 `tool` 消息写回对话。
3. 模型基于天气结果选择 `get_attraction`。
4. 没有工具调用时，模型给出最终自然语言回答，循环结束。

这就是 `Observation -> Tool call -> Observation -> Final answer`。设置 `turn < 6` 是重要的防护：生产系统还应增加调用预算、超时、重试、审计日志和敏感操作的人工确认。

## 1.3 工作流与 Agent

两者都可能调用 LLM 和工具，差异在控制流的归属：

| 类型 | 控制流由谁定义 | 适合场景 |
| --- | --- | --- |
| Workflow | 开发者预先确定 | 报表生成、固定审批、确定性 ETL |
| Agent | 模型根据观察动态选择 | 开放式研究、排障、跨工具任务 |

一个实用原则：任务步骤稳定、错误代价高时，先写工作流；只有在工具选择或步骤确实依赖开放环境时才引入 Agent。Agent 的自主性不应绕过权限边界。

## 1.4 练习

1. 为旅行助手增加 `get_transport` 工具，并让模型根据天气推荐交通方式。
2. 将本地景点对象替换为搜索 API。为 API 响应设置大小上限和超时。
3. 记录每轮的 `tool_calls`、耗时和结果，给一次失败调用设计重试策略。
4. 让用户请求“预订酒店”时只产生草案，绝不执行真实下单。说明确认点应在循环的哪一层。

## 1.5 学习疑问解答

### 疑问 1：`client.chat.completions.create`、`tools` 和 `tool_choice` 的作用是什么？

```js
const completion = await client.chat.completions.create({
  model,
  messages,
  tools,
  tool_choice: "auto",
  temperature: 0.2,
});
```

这段代码是 Agent 循环中“请模型决定下一步”的一次请求。它将当前对话历史、可用工具说明和模型参数一起发送给大语言模型，随后等待模型返回一条 `assistant` 消息。返回值可能是最终自然语言回答，也可能包含一个或多个 `tool_calls`。

- `model`：本次调用使用的模型名称，例如 `deepseek-chat`。
- `messages`：截至当前轮的完整上下文。它包含系统规则、用户任务，以及前几轮模型发起的工具调用和工具返回的结果。
- `temperature: 0.2`：控制输出随机性。较低值更适合工具调用，因为参数和步骤会更稳定；它不保证模型一定正确。

#### `tools`：给模型看的工具“说明书”

`tools` 是工具定义数组。每一项包含工具名、用途和 JSON Schema 参数约束，例如 `get_weather` 要求一个字符串 `city`。模型通过它了解“现在有哪些能力可以请求使用”以及“参数该如何组织”。

它**不会执行 JavaScript 函数**。模型只能返回类似下面的请求：

```json
{
  "name": "get_weather",
  "arguments": "{\"city\":\"北京\"}"
}
```

真正的执行发生在后面的循环中：程序从 `assistant.tool_calls` 取出名称和参数，调用 `implementations[call.function.name]`，再把结果作为 `role: "tool"` 消息写回 `messages`。因此，模型负责选择，应用代码负责执行和权限控制。

#### `tool_choice: "auto"`：谁决定是否调用工具

`"auto"` 表示由模型根据当前任务自行决定：

- 信息已经足够时，直接返回自然语言回答，此时 `tool_calls` 为空，循环结束。
- 需要天气、计算或其他外部信息时，返回工具调用请求，程序执行工具后进入下一轮。

常见的其他策略如下：

| 设置 | 含义 | 适合场景 |
| --- | --- | --- |
| `"auto"` | 模型自行决定是否调用工具 | 大多数开放式 Agent 任务 |
| `"none"` | 禁止模型调用工具 | 只允许总结已有信息 |
| `"required"` | 要求模型至少调用一个工具 | 必须获取外部事实的流程；需确认模型服务支持 |
| `{ type: "function", function: { name: "get_weather" } }` | 强制调用指定工具 | 某一步有明确、固定的工具依赖 |

`tools` 与 `tool_choice` 不能替代安全控制。即使使用 `"auto"`，程序仍必须通过 `implementations` 白名单、参数校验、超时和权限检查来决定是否真正执行。

### 疑问 2：定义了 `tools` 后是否必须调用？用户没有给城市时是否需要额外流程？

不需要。`tools` 是模型**可以请求使用**的能力集合，不是必须按顺序执行的待办列表。当前示例使用 `tool_choice: "auto"`，模型可以在每轮选择直接回答、提出澄清问题，或者调用一个或多个工具。

例如，用户输入“我要去旅游，推荐一个合适的旅游景点”，但没有提供城市。`get_weather` 的参数 Schema 要求 `city`，而且系统规则要求不要编造实时天气。此时模型回复“你现在在哪个城市”是正确的：它避免猜测城市，也避免生成无效工具参数。

不能用 `tool_choice: "required"` 解决信息缺失问题。它会强迫模型调用某个工具，却无法提供真实的 `city`，反而容易导致模型猜参数、触发校验错误或得到无意义结果。

#### 是否需要增加流程，取决于产品目标

| 目标 | 合适做法 |
| --- | --- |
| 用户愿意对话补充信息 | 模型直接追问城市；界面或 CLI 接收用户下一条消息后继续同一段 `messages` 历史 |
| 希望一次输入就生成计划 | 在表单中把城市设为必填字段，或在用户资料中读取已授权的默认城市 |
| 只想给泛化灵感 | 增加不依赖城市的工具/逻辑，例如“按兴趣推荐旅行类型”；不要伪装成实时天气推荐 |

对于当前旅行 Agent，完整的多轮过程应为：

```text
用户：我要去旅游
模型：请问去哪个城市？          <- 不调用工具，等待用户补充
用户：北京
模型：调用 get_weather(北京)    <- 程序执行工具并写回结果
模型：调用 get_attraction(...)  <- 使用天气结果
模型：返回最终景点建议
```

现有示例在“没有 `tool_calls`”时会打印模型文本并 `break`，因此会把“请问去哪个城市？”当作本轮最终输出。要支持上面的对话流程，需要在外层增加一个交互循环：保留当前 `messages`，显示模型的追问，读取下一条用户输入，再追加 `{ role: "user", content: "北京" }` 后重新调用模型。这个外层循环是**多轮对话状态管理**，不是额外强制调用工具。

### 疑问 3：Vibe Coding 中说的“上下文”就是 `messages` 吗？对话太多会导致 `messages` 过多吗？

在当前 `travel-agent.js` 这种 Chat Completions 实现中，`messages` 是每次发送给模型的**主要上下文载体**。每轮请求都会携带系统规则、用户消息、模型回复、工具调用请求和工具执行结果。因此，持续对话确实会让 `messages` 数组变长。

但“上下文”比 `messages` 更宽：它还包括本次声明的 `tools` Schema、系统/开发者指令、检索到的文档、记忆、代码文件片段和模型服务本身允许的上下文窗口。Vibe Coding 中的上下文通常也包含编辑器自动收集的当前文件、打开的文件和终端结果，不只是一段聊天记录。

真正的限制是 **token 数量**，不是 `messages.length`。一条很长的工具结果可能比十条短对话占用更多 token。上下文过长会带来三个问题：

- 超过模型上下文窗口，API 直接拒绝请求或无法处理全部输入。
- 即使未超限，输入 token 更多，调用成本和延迟也会上升。
- 无关历史会分散模型注意力，旧指令或过时事实可能降低回答质量。

当前示例为了教学直接累积完整 `messages`。真实 Agent 通常将“保存历史”和“发送给模型”分开：

```text
完整会话记录（数据库或文件）
        |
        +-> 最近若干完整对话轮次
        +-> 历史摘要
        +-> 与当前问题相关的长期记忆 / RAG 证据
        +-> 系统规则与工具定义
              |
              +-> 本次 API 的 request messages
```

常见策略是保留固定的系统规则、最近几轮完整对话，以及一段历史摘要；用户偏好等长期事实写入第八章的记忆系统；文档知识按需检索，而不是始终附在 `messages` 中。裁剪时不能只粗暴地 `slice` 数组：一个 `role: "tool"` 消息必须和它前面的工具调用请求保持配对。应按完整对话轮次压缩或删除，避免留下孤立工具结果。

### 疑问 4：控制台中的“输入（命中缓存）”与 `messages` 有关系吗？

有关系。许多模型服务会对请求中**重复的输入前缀**做 Prompt Cache（上下文缓存）。在当前 Agent 中，每一轮请求通常具有这样的结构：

```text
固定系统提示 + 固定 tools Schema + 之前完整 messages 历史 + 新增的一条消息
```

第二轮及之后再次发送时，前面的系统提示、工具定义和旧对话历史与上一轮相同。服务端若仍保留该前缀的缓存，就可以复用此前计算过的 token 表示，于是控制台会将这部分统计为“输入（命中缓存）”；末尾新增的用户消息、工具结果或模型输出之后的新输入则通常统计为“输入（未命中缓存）”。

这不是 JavaScript 中的 `messages` 数组被自动存到了本地，也不是模型“永久记住了对话”。它是模型服务端的短期计算复用机制，具体的最小前缀长度、有效时间、计费折扣和命中规则取决于模型提供商。

#### 对 Agent 开发的影响

- 保持系统提示、工具定义和消息顺序稳定，有利于缓存命中。
- 每轮在末尾追加新消息，通常比每次重排或重写全部历史更容易复用前缀。
- 不要在系统提示前部插入每轮变化的时间戳、随机 ID 或动态说明；这种变化会使其后的前缀难以命中缓存。
- 历史摘要、裁剪或更换工具 Schema 后，变化点之后的内容可能不再命中，这是正常现象。

缓存命中通常能降低输入延迟和费用，但**不会减少上下文窗口占用**。即使 14,080 个输入 token 命中缓存，它们仍属于本次模型可见的上下文，仍可能因 `messages` 过长而触及上下文上限。因此，缓存优化和第三条中的上下文压缩需要同时做。
