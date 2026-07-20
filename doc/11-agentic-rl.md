# 第十一章 Agentic RL：Node.js 视角

对应原教程：`docs/chapter11/第十一章 Agentic-RL.md`。Agentic RL 将 Agent 的多步轨迹看作环境交互：状态包含目标、上下文和工具结果；行动包含文本或工具调用；奖励衡量最终结果、过程质量、成本和安全性。

## 11.1 训练与运行时的职责

对大语言模型进行 SFT、LoRA、PPO/GRPO 等 GPU 训练通常使用 Python 的 PyTorch、Transformers、TRL 与分布式工具。Node.js 在这一体系中非常适合：生成/管理任务、调用已部署模型产生 rollout、运行沙箱环境、计算可程序化奖励、保存轨迹和对比评测。

```text
任务集 -> Node rollout runner -> Agent / 工具环境 -> 轨迹
                              <- 奖励函数 / 验证器 <-
轨迹与奖励 -> GPU 训练作业 -> 新模型 -> 独立评测集
```

切勿用生产用户数据直接做在线探索或自动训练；需取得授权、脱敏、隔离环境和离线评测后再考虑受控发布。

## 11.2 奖励函数：可验证优先

奖励设计决定模型会学什么。一个好原则是优先使用可程序化、可复现的验证器，例如单元测试、精确答案、JSON Schema、工具轨迹约束和成本上限；LLM Judge 适合补充开放性质量，但不要成为唯一奖励来源。

下面是一个简单的任务完成奖励函数。保存为 `reward.js`：

```js
function toolCallsAreAllowed(trajectory, allowed) {
  return trajectory.toolCalls.every((call) => allowed.has(call.name));
}

export function scoreTrajectory({ answer, expected, trajectory, maxToolCalls = 3 }) {
  const exact = answer.trim().toLowerCase() === expected.trim().toLowerCase() ? 1 : 0;
  const validTools = toolCallsAreAllowed(trajectory, new Set(["calculator", "search"]));
  const costPenalty = Math.max(0, trajectory.toolCalls.length - maxToolCalls) * 0.1;
  const safetyPenalty = validTools ? 0 : 1;
  return {
    exact, validTools,
    reward: Math.max(-1, exact - costPenalty - safetyPenalty),
  };
}

console.log(scoreTrajectory({
  answer: "42", expected: "42", trajectory: { toolCalls: [{ name: "calculator" }] },
}));
```

奖励的常见漏洞包括：只奖励格式导致空洞答案、只奖励最终答案导致危险过程、只奖励工具调用成功导致无效调用。每次改变奖励函数都要在保留集检查意外行为。

## 11.3 用 Node.js 采集 Rollout

Rollout 是一次完整的 `(task, actions, observations, answer, reward)`。下面是框架无关的采集器：

```js
import { scoreTrajectory } from "./reward.js";

export async function collectRollout(task, agent) {
  const startedAt = Date.now();
  const result = await agent.run(task.prompt); // 约定返回 answer 与结构化 toolCalls
  const score = scoreTrajectory({ answer: result.answer, expected: task.expected, trajectory: result });
  return {
    taskId: task.id, prompt: task.prompt, expected: task.expected,
    answer: result.answer, toolCalls: result.toolCalls,
    reward: score.reward, checks: score,
    latencyMs: Date.now() - startedAt, model: result.model,
  };
}

const jsonl = (records) => records.map((record) => JSON.stringify(record)).join("\n");
```

保存时采用 JSONL、显式 schema 版本和不可变 `taskId`；将训练、验证和测试任务严格分离。训练 job 只读取经过验证的离线 rollout，且训练完成后必须在未参与调优的测试集重新评测。

## 11.4 GRPO 的直觉

对同一提示产生一组候选轨迹，计算每条的奖励相对组平均值，奖励更高的候选被提高概率，较差候选被降低概率。以下仅演示组内标准化，不是训练代码：

```js
export function relativeAdvantages(rewards) {
  const mean = rewards.reduce((sum, value) => sum + value, 0) / rewards.length;
  const variance = rewards.reduce((sum, value) => sum + (value - mean) ** 2, 0) / rewards.length;
  const std = Math.sqrt(variance) || 1;
  return rewards.map((reward) => (reward - mean) / std);
}

console.log(relativeAdvantages([1, 0.8, 0, -0.2]));
```

实际 GRPO 还涉及 token 概率、参考策略、KL 约束、优化器和稳定性控制，应使用成熟训练库并记录版本、随机种子、超参数和硬件环境。

## 11.5 练习

1. 为一个 JSON 提取任务写 schema 奖励、字段准确率奖励和长度惩罚。
2. 构造“答案正确但调用了禁止工具”的 rollout，确认总奖励为负。
3. 将 rollout 写入 JSONL，并编写读取时的 schema 验证。
4. 设计离线训练、影子评测、灰度发布和回滚四阶段流程。
