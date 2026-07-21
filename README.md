# Agent Learning Lab

基于 Node.js 的 Agent 学习与实践项目：按章节提供可运行示例、测试和本地演示数据，把 Agent 概念落到模型调用、工具使用、记忆、RAG、上下文工程和评测等实践上。

[`doc/`](./doc/README.md) 中的学习文档参考 [datawhalechina/Hello-Agents](https://github.com/datawhalechina/Hello-Agents) 编写，示例已改写为现代 JavaScript（Node.js 20+、ESM）。文档配合本仓库学习，不是原项目官方译本；可运行实现在 `src/`，测试在 `tests/`。

## 快速开始

```bash
pnpm install
```

在项目根目录创建 `.env` 并填入模型配置：

```dotenv
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-v4-flash
```

`.env` 已在 Git 忽略列表中；切换模型服务时只改其中的地址、模型和 Key。

启动当前入口 Agent（默认是 01 阶段旅游助手）：

```bash
pnpm start
```

`pnpm start` 与 `pnpm run dev` 等价，都会读取 `.env` 并执行根目录 `index.js`。对话中输入 `exit` / `quit` / `q` / `退出` 可结束。

## 切换学习阶段

入口只认 `index.js` 里的 import。默认加载 01 阶段：

```js
import "./src/01-foundations/travel-agent.js";
```

进入下一阶段时，改成对应路径即可，例如：

```js
import "./src/02-tools-and-patterns/your-agent.js";
```

也可以单独跑某一阶段（不经过 `index.js`）：

```bash
pnpm run dev:01
```

## 终端对话 UI

各阶段可复用 `src/shared/terminal-chat.js`，统一处理横幅、角色标签、思考动画、工具结果展示和输入循环。新阶段示例：

```js
import { createTerminalChat } from "../shared/terminal-chat.js";

const ui = createTerminalChat({
  title: "Agent 标题",
  subtitle: "阶段说明",
  agentName: "旅游助手",
  promptLabel: "用户",
});

await ui.runLoop(async (userInput) => {
  // 业务逻辑：调模型 / 跑工具
  // ui.printAssistant(text)
  // ui.printTool(name, result)
  // await ui.withSpinner("正在思考…", () => ...)
});
```

## 目录

```text
index.js                      项目入口（改 import 切换阶段）
src/
  shared/                     可复用能力（终端对话 UI 等）
  01-foundations/             第 1-3 章：模型调用、语言模型基础
  02-tools-and-patterns/      第 4-7 章：工具、范式与 Agent 框架
  03-memory-and-rag/          第 8 章：记忆、检索与知识库
  04-context-and-protocols/   第 9-10 章：上下文工程与 MCP/A2A
  05-evaluation-and-projects/ 第 11-16 章：RL、评测与综合项目
tests/                        单元测试与评测任务
data/                         本地演示数据（不提交敏感数据）
doc/                          基于 Hello-Agents 改写的 Node.js 学习文档
```

建议从 `src/01-foundations/` 的旅游助手开始，再依次实现工具调用、记忆、RAG 和评测。
