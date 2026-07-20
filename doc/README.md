# Agent Learning Lab 配套学习文档

本目录收录已迁入 `agent-learning-lab` 的 Hello-Agents Node.js 学习文档。文档保留原教程的学习顺序和问题意识，所有可执行示例统一使用现代 JavaScript（Node.js 20+、ESM）。对应的可运行练习、测试和项目配置位于上一级目录的 `src/`、`tests/` 与 [项目 README](../README.md)。

这些文档是面向本项目的学习笔记，并非原项目的官方译本；原始理论表述、插图和完整练习请以原教程为准。

## 使用方式

每章的代码块都可以单独复制到 `.js` 文件执行；完整的学习流程和项目初始化方式请参阅上一级目录的 [项目 README](../README.md)。需要独立运行示例时，先在该示例目录执行：

```bash
npm init -y
npm pkg set type=module
npm install openai dotenv
```

示例默认使用 OpenAI 兼容接口，所以 OpenAI、DeepSeek、硅基流动、vLLM 或 Ollama 都可接入。不要把密钥写进代码或提交到 Git；使用 `.env`：

```dotenv
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4.1-mini
```

`LLM_BASE_URL` 对 OpenAI 官方接口可省略。Ollama 的常见地址是 `http://localhost:11434/v1`。

## 目录

| 原教程 | 本教程 | 状态 |
| --- | --- | --- |
| 第一章 初识智能体 | [01-first-agent.md](./01-first-agent.md) | 已完成 |
| 第二章 智能体发展史 | [02-agent-history-and-eliza.md](./02-agent-history-and-eliza.md) | 已完成 |
| 第三章 大语言模型基础 | [03-llm-fundamentals.md](./03-llm-fundamentals.md) | 已完成 |
| 第四章 智能体经典范式构建 | [04-agent-patterns.md](./04-agent-patterns.md) | 已完成 |
| 第五章 基于低代码平台的智能体搭建 | [05-low-code-platforms.md](./05-low-code-platforms.md) | 已完成 |
| 第六章 框架开发实践 | [06-framework-development.md](./06-framework-development.md) | 已完成 |
| 第七章 构建你的 Agent 框架 | [07-build-agent-framework.md](./07-build-agent-framework.md) | 已完成 |
| 第八章 记忆与检索 | [08-memory-and-retrieval.md](./08-memory-and-retrieval.md) | 已完成 |
| 第九章 上下文工程 | [09-context-engineering.md](./09-context-engineering.md) | 已完成 |
| 第十章 智能体通信协议 | [10-agent-protocols.md](./10-agent-protocols.md) | 已完成 |
| 第十一章 Agentic RL | [11-agentic-rl.md](./11-agentic-rl.md) | 已完成 |
| 第十二章 智能体性能评估 | [12-agent-evaluation.md](./12-agent-evaluation.md) | 已完成 |
| 第十三章 智能旅行助手 | [13-travel-assistant.md](./13-travel-assistant.md) | 已完成 |
| 第十四章 自动化深度研究智能体 | [14-deep-research-agent.md](./14-deep-research-agent.md) | 已完成 |
| 第十五章 构建赛博小镇 | [15-cyber-town.md](./15-cyber-town.md) | 已完成 |
| 第十六章 毕业设计 | [16-graduation-project.md](./16-graduation-project.md) | 已完成 |

建议先完成第一章的工具调用循环，再阅读第二章的规则系统边界，最后学习第三章的语言模型与 API 基础；随后按目录顺序完成框架、记忆、上下文、协议、评测与综合项目章节。
