# Agent Learning Lab

这是一个基于 Node.js 的 Agent 学习与实践项目：按章节提供可运行的示例、测试和本地演示数据，帮助将 Agent 概念落实为模型调用、工具使用、记忆、RAG、上下文工程和评测等实践。

[`doc/`](./doc/README.md) 中的学习文档参考 [datawhalechina/Hello-Agents](https://github.com/datawhalechina/Hello-Agents) 的步骤教程编写，并将示例改写为现代 JavaScript（Node.js 20+、ESM）版本。文档用于配合本项目学习，不是原项目的官方译本；对应的可运行实现位于 `src/`，测试位于 `tests/`。

## 初始化

```bash
pnpm install
pnpm run dev
```

在项目根目录的 `.env` 中填入模型配置后，运行旅行助手示例：

```dotenv
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-v4-flash
```

`.env` 已在 Git 忽略列表中；需要切换模型服务时，只修改其中的地址、模型和 Key。

```bash
pnpm start
```

启动脚本会自动读取 `.env`。第一个练习建议从 `src/01-foundations/` 的旅行助手开始，随后依次实现工具调用、记忆、RAG 和评测。

## 目录

```text
src/
  01-foundations/             第 1-3 章：模型调用、语言模型基础
  02-tools-and-patterns/      第 4-7 章：工具、范式与 Agent 框架
  03-memory-and-rag/          第 8 章：记忆、检索与知识库
  04-context-and-protocols/   第 9-10 章：上下文工程与 MCP/A2A
  05-evaluation-and-projects/ 第 11-16 章：RL、评测与综合项目
tests/        单元测试与评测任务
data/         本地演示数据（不提交敏感数据）
doc/          基于 Hello-Agents 改写的 Node.js 学习文档
```
