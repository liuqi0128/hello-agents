# 第十章 智能体通信协议：Node.js 实践

对应原教程：`docs/chapter10/第十章 智能体通信协议.md`。协议解决的核心问题是互操作：模型/应用不必为每个工具或远程 Agent 手写一次专用适配器。

| 协议/模式 | 解决的问题 | 典型边界 |
| --- | --- | --- |
| MCP | Agent 与工具、资源、提示的标准化连接 | 本地 stdio 或远程 HTTP 服务 |
| A2A 风格服务 | 一个 Agent 请求另一个专业 Agent 完成任务 | HTTP 任务接口与能力描述 |
| 服务发现 | 找到具备特定能力的服务并做路由 | 注册中心、健康检查、负载信息 |

协议不授予权限。即使客户端通过 MCP 发现了一个工具，服务端仍须验证身份、授权、输入和资源范围。

## 10.1 编写第一个 MCP Server

安装依赖：

```bash
npm init -y
npm pkg set type=module
npm install @modelcontextprotocol/sdk zod
```

保存为 `weather-mcp-server.js`。stdio 协议会被 MCP 客户端使用，因此不要向 `stdout` 输出调试日志，日志应写入 `stderr`。

```js
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "weather-demo", version: "1.0.0" });

server.tool(
  "get_weather",
  "获取指定城市的演示天气；仅用于教学，不是实时数据。",
  { city: z.string().min(1).max(40).describe("城市名称") },
  async ({ city }) => ({
    content: [{ type: "text", text: JSON.stringify({ city, condition: "晴", temperatureC: 26, source: "demo" }) }],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("weather-demo MCP server started");
```

把这个命令配置到支持 MCP 的客户端后，客户端会发现 `get_weather` 的名称、描述和 Zod 派生的输入 Schema，并可调用它。生产工具应加上请求超时、服务端认证、速率限制、审计日志和真实数据源的授权检查。

## 10.2 MCP 客户端的接入原则

客户端通常做四件事：启动/连接 server，列出工具，将工具 Schema 映射给模型，收到模型调用后转发并回填结果。无论使用 SDK、LangChain.js 还是桌面客户端，均应遵守：

- 每个 MCP server 以最小权限运行，文件系统 server 必须限定工作目录。
- 远程 server 要验证 TLS、身份与供应商来源；不要把任意 URL 交给模型连接。
- 对每个工具名称建立应用层 allowlist，特别是写入、网络和凭证相关工具。
- 将工具输出视为不可信数据，防范提示注入和敏感信息回流。

## 10.3 A2A 风格的专业 Agent 服务

Agent-to-Agent 协作可以用普通 HTTP API 实现。下面的研究 Agent 只接受声明的任务类型，并返回可验证的领域对象。安装 `express zod`：

```js
import express from "express";
import { z } from "zod";

const app = express();
app.use(express.json({ limit: "32kb" }));

const requestSchema = z.object({
  taskId: z.string().uuid(),
  capability: z.literal("research-summary"),
  topic: z.string().min(3).max(200),
});

app.get("/.well-known/agent.json", (_, res) => res.json({
  name: "research-agent",
  capabilities: ["research-summary"],
  endpoint: "/tasks",
  version: "1.0.0",
}));

app.post("/tasks", async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
  // 此处调用受控的检索/模型流程；不要直接信任 topic 中的指令。
  return res.json({ taskId: parsed.data.taskId, status: "completed", result: {
    topic: parsed.data.topic, summary: "演示研究摘要", sources: [],
  } });
});

app.listen(3100);
```

协调 Agent 先读取能力描述，选择允许的 capability，再以 `taskId` 追踪状态和重试。复杂协作还应定义异步状态、取消、幂等键、版本协商和错误码；不要用自然语言约定代替协议字段。

## 10.4 服务发现和路由

小型系统可将已批准服务写入静态配置；大型系统使用注册中心记录能力、版本、健康状态、地区和负载。路由器选择的是符合安全和 SLA 约束的服务，不是“模型认为看起来合适”的任意地址。

## 10.5 练习

1. 为 MCP server 添加 `add` 工具，拒绝非有限数值。
2. 给研究 Agent 加入 `Authorization` 校验与每任务的幂等键。
3. 定义一个异步任务的 `queued/running/completed/failed` 状态模型。
4. 设计文件系统 MCP server 的路径、扩展名和写操作确认策略。
