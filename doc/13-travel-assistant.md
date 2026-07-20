# 第十三章 智能旅行助手：Node.js 全栈后端设计

对应原教程：`docs/chapter13/第十三章 智能旅行助手.md`。本章将前面的工具、记忆、MCP 和多 Agent 概念组合为一个可交付的旅行规划服务。界面可使用 Vue、React 或小程序；本教程聚焦稳定的 Node.js API 契约。

## 13.1 架构与数据流

```text
浏览器/客户端 -> POST /api/trips -> TripOrchestrator
                                 -> 偏好解析 Agent
                                 -> 天气/地图/交通工具
                                 -> 行程规划 Agent -> JSON 校验 -> 响应
```

不要让每个 Agent 自己发起任意网络请求。地图、天气、图片和预订数据应作为经过认证、限流和审计的工具提供；真正的预订动作必须由用户在最终页面确认。

## 13.2 领域模型与输入校验

安装：`npm install express zod dotenv`。用 Zod 在 HTTP 边界校验输入和输出，替代 Python Pydantic 的角色。

```js
import { z } from "zod";

export const tripRequestSchema = z.object({
  city: z.string().min(1).max(80),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  travelers: z.number().int().min(1).max(20),
  budgetCny: z.number().positive().max(200_000),
  interests: z.array(z.string().min(1).max(30)).max(10).default([]),
});

export const itineraryItemSchema = z.object({
  day: z.number().int().positive(),
  time: z.string(), title: z.string(),
  location: z.string(), estimatedCostCny: z.number().nonnegative(),
  rationale: z.string(),
});

export const tripPlanSchema = z.object({
  summary: z.string(),
  weatherNote: z.string(),
  totalEstimatedCostCny: z.number().nonnegative(),
  itinerary: z.array(itineraryItemSchema).min(1),
  sources: z.array(z.object({ name: z.string(), url: z.string().url().optional() })),
});
```

日期范围、预算、城市有效性和第三方数据质量都要在服务端再次验证。模型输出即使看起来是 JSON，也必须通过 `tripPlanSchema.safeParse` 后才能发给用户。

## 13.3 协调多 Agent，但保持单一事实来源

角色可以分为偏好分析、实时信息、路线规划和质量检查。协调器负责状态和最终校验，而不是把多个自然语言回答直接拼接：

```js
export async function createTripPlan(input, { preferenceAgent, weatherTool, plannerAgent, reviewerAgent }) {
  const preferences = await preferenceAgent.run(input);
  const weather = await weatherTool({ city: input.city, startDate: input.startDate, endDate: input.endDate });
  const draft = await plannerAgent.run({ input, preferences, weather });
  const review = await reviewerAgent.run({ input, weather, draft });
  if (!review.approved) throw new Error(`计划未通过审查：${review.issues.join("；")}`);
  return tripPlanSchema.parse({ ...draft, weatherNote: weather.summary });
}
```

并行只能用于互不依赖的只读操作，例如天气和景点查询。预算汇总、日期冲突检查、最终推荐必须在一个明确步骤中完成，否则不同 Agent 会基于不一致的事实做决定。

## 13.4 Express API 与进度事件

短任务可直接返回 JSON；长规划使用 SSE 或任务队列。以下是最小同步端点：

```js
import express from "express";
import { tripRequestSchema } from "./schemas.js";
import { createTripPlan } from "./orchestrator.js";

const app = express();
app.use(express.json({ limit: "64kb" }));
app.post("/api/trips", async (req, res) => {
  const input = tripRequestSchema.safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: "invalid_input", details: input.error.flatten() });
  try {
    const plan = await createTripPlan(input.data, services);
    return res.status(201).json(plan);
  } catch (error) {
    return res.status(502).json({ error: "planning_failed", message: error.message });
  }
});
app.listen(3000);
```

客户端编辑行程时应只提交可编辑字段，并在服务端重新计算预算。导出 Markdown/PDF 是渲染层功能，导出的内容应包含信息来源和“价格/天气以实时服务为准”的提示。

## 13.5 练习

1. 为路线加入每日最大步行距离，并在审查 Agent 中验证。
2. 将规划变为异步任务：`POST /trips` 返回任务 ID，`GET /trips/:id/events` 输出 SSE 进度。
3. 为地图 MCP 工具设计城市与坐标的输入 Schema、速率限制和缓存键。
4. 增加“保存草案”和“确认预订”两条严格分离的 API。
