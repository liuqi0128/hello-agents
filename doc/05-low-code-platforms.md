# 第五章 基于低代码平台的智能体搭建：Node.js 加成

对应原教程：`docs/chapter5/第五章 基于低代码平台的智能体搭建.md`。

原教程介绍 Coze、Dify、FastGPT 和 n8n 的平台内操作。本章不复述每个版本随界面变化的点击路径，而是补上 JavaScript 开发者需要掌握的边界：何时用平台、如何通过 API/Webhook 接入，以及如何将平台工作流纳入工程化系统。

## 5.1 低代码平台适合什么

低代码平台把模型、提示、知识库、工作流和监控组织为可视化节点。它特别适合快速验证、运营可编辑的内容流、固定审批链和非工程人员参与的流程。

| 平台能力 | Node.js 负责的部分 |
| --- | --- |
| 可视化编排、Prompt、知识库 | 业务系统鉴权、数据预处理、Webhook 接收 |
| Agent/Workflow 执行 | 调用平台 API、校验返回、兜底与审计 |
| 运营配置与测试 | 配置版本控制、CI、密钥管理、观测 |

不要把可视化节点当作安全边界。权限判断、支付/发信/删数据等副作用必须仍由受控后端决定。

## 5.2 调用平台的工作流 API

不同平台的 URL、认证头和返回结构会变化，因此把它们封装到一个适配器中，不要散落在业务代码。以下是通用的 HTTP 调用模式，保存为 `workflow-client.js`：

```js
export async function runWorkflow({ endpoint, apiKey, inputs, userId }) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      inputs,
      response_mode: "blocking",
      user: userId,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`工作流调用失败 (${response.status})：${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("工作流返回的不是 JSON");
  }
}
```

以 Dify 的工作流 API 为例，可在调用点提供形如 `https://api.dify.ai/v1/workflows/run` 的 endpoint；实际字段和输出应以你部署版本的 API 文档为准。调用侧应把平台响应转换为自己的领域对象，而不是把供应商 JSON 直接返回给前端：

```js
import { runWorkflow } from "./workflow-client.js";

const result = await runWorkflow({
  endpoint: process.env.DIFY_WORKFLOW_URL,
  apiKey: process.env.DIFY_API_KEY,
  inputs: { topic: "今天的 AI 新闻" },
  userId: "user_123", // 使用内部不可猜测的 ID，不要放邮箱或手机号
});

const report = {
  runId: result.workflow_run_id,
  text: result.data?.outputs?.text ?? "工作流未产出文本",
};
```

## 5.3 将 Node.js 服务作为工作流工具

平台通常可调用 HTTP 工具。下面是一个只读的 Express 服务，可作为 n8n、Dify 或 Coze 的工具后端。它验证服务间令牌并返回结构化结果。

```bash
npm install express zod dotenv
```

```js
import "dotenv/config";
import express from "express";
import { z } from "zod";

const app = express();
app.use(express.json({ limit: "32kb" }));

const querySchema = z.object({ symbol: z.string().regex(/^[A-Z.]{1,10}$/) });

app.post("/tools/company-summary", async (req, res) => {
  if (req.get("x-tool-token") !== process.env.TOOL_SHARED_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const parsed = querySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

  // 此处应调用经过授权的数据源；不要由模型拼接 SQL 或 URL。
  const { symbol } = parsed.data;
  return res.json({ symbol, summary: `${symbol} 的演示摘要`, source: "demo", asOf: new Date().toISOString() });
});

app.listen(3000, () => console.log("tool server listening on :3000"));
```

在平台中把该接口声明为工具时，明确输入 Schema、超时、认证头和不允许的副作用。对于写操作，将“创建草案”和“最终提交”拆成两个端点，最终提交必须有用户确认令牌。

## 5.4 平台选型与上线检查

Coze 适合快速构建对话与插件体验；Dify 常用于知识库和应用交付；FastGPT 聚焦知识库问答；n8n 擅长连接 SaaS 和定时/事件工作流。实际选择取决于部署方式、数据合规、模型供应商、可观测性和团队所有权，而不是功能列表的长短。

上线前至少检查：

- 将 API Key 放在平台/部署环境的 Secret 中，不进入 Prompt、日志或前端。
- 为每个外部调用设置超时、重试上限与幂等键。
- 对知识库检索结果显示来源，并评估权限过滤是否在检索前生效。
- 导出工作流定义，连同 Prompt、工具 Schema 和测试样例一起版本管理。
- 记录工作流版本、输入摘要、模型、工具调用和最终输出，遵守数据保留策略。

## 5.5 练习

1. 用 n8n 创建“Webhook -> LLM -> HTTP Response”工作流，再用 `fetch` 从 Node.js 调用它。
2. 将 `company-summary` 改造成一个只读天气或库存工具，为它增加速率限制。
3. 设计一个“邮件草稿”工作流，标出必须由用户确认的节点。
4. 为一个平台工作流写三条契约测试：正常输出、超时、非法输入。
