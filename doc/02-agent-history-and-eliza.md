# 第二章 智能体发展史：从规则到 LLM

对应原教程：`docs/chapter2/第二章 智能体发展史.md`。

## 2.1 一条理解现代 Agent 的历史线

现代 Agent 并非凭空出现。三个重要思想传统至今仍影响架构选择：

| 思想 | 知识/能力来源 | 优点 | 主要限制 |
| --- | --- | --- | --- |
| 符号主义 | 人编写的规则、逻辑、知识库 | 可解释、可验证 | 规则覆盖和维护成本高 |
| 联结主义 | 从数据学习的神经网络参数 | 擅长模式识别和泛化 | 难解释，数据与算力需求高 |
| 强化学习 | 与环境交互得到的奖励 | 能优化序列决策 | 奖励设计和探索成本困难 |
| LLM Agent | 预训练模型加工具、记忆和循环 | 自然语言接口、通用性强 | 可能幻觉，行动需要约束 |

符号系统的代表是专家系统和 ELIZA。它们把“如果出现某模式，就采取某回应”显式写入程序。下面用 Node.js 重建一个可运行的简化版 ELIZA，目的是理解其边界，而不是模拟心理咨询。

## 2.2 构建规则聊天机器人

保存为 `eliza.js`。此版本包含优先级、正则捕获、代词替换和少量会话状态。状态的加入仅用于演示，不能弥补规则系统缺少语义理解的问题。

```js
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const rules = [
  {
    priority: 100,
    pattern: /^我需要(.+)$/,
    replies: ["你为什么需要{0}？", "得到{0}会带来什么改变？", "你确定现在需要{0}吗？"],
  },
  {
    priority: 90,
    pattern: /^我(是|感到)(.+)$/,
    replies: ["你从什么时候开始{1}？", "{1}让你想到什么？", "你认为为什么会{1}？"],
  },
  {
    priority: 80,
    pattern: /(?:我的)?(妈妈|母亲|父亲|爸爸)(.*)/,
    replies: ["请多谈谈你的{1}。", "你和{1}的关系是怎样的？"],
  },
  {
    priority: 70,
    pattern: /^为什么我不能(.+)？?$/,
    replies: ["你认为自己应该能够{0}吗？", "如果你能{0}，接下来会怎样？"],
  },
  {
    priority: 0,
    pattern: /(.+)/,
    replies: ["请再多说一点。", "这件事让你有什么感受？", "我们可以从哪里继续谈起？"],
  },
].sort((a, b) => b.priority - a.priority);

const pronouns = new Map([
  ["我", "你"], ["我的", "你的"], ["你", "我"], ["你的", "我的"],
]);

function swapPronouns(text) {
  // 同时替换会互相污染，所以先替换为占位符。
  const entries = [...pronouns.entries()].sort(([a], [b]) => b.length - a.length);
  let out = text;
  entries.forEach(([from], index) => { out = out.replaceAll(from, `\u0000${index}\u0000`); });
  entries.forEach(([, to], index) => { out = out.replaceAll(`\u0000${index}\u0000`, to); });
  return out;
}

function choose(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function respond(message, memory) {
  const name = message.match(/我叫([\u4e00-\u9fa5A-Za-z]{1,20})/);
  if (name) {
    memory.name = name[1];
    return `很高兴认识你，${memory.name}。你今天想聊什么？`;
  }
  if (/我是谁|我的名字/.test(message) && memory.name) {
    return `你之前告诉我，你叫${memory.name}。`;
  }

  for (const rule of rules) {
    const match = message.match(rule.pattern);
    if (!match) continue;
    return choose(rule.replies).replace(/\{(\d+)\}/g, (_, index) => {
      return swapPronouns(match[Number(index)]?.trim() ?? "");
    });
  }
}

const rl = readline.createInterface({ input, output });
const memory = {};
console.log("ELIZA：你好。输入 exit 结束对话。");
while (true) {
  const message = (await rl.question("你：")).trim();
  if (/^(exit|quit|再见|拜拜)$/i.test(message)) break;
  if (message) console.log(`ELIZA：${respond(message, memory)}`);
}
rl.close();
```

运行：`node eliza.js`。可以依次输入“我叫小王”“我感到压力很大”“我的名字是什么”观察规则和状态怎样工作。

### 为什么它看起来会聊天

算法只有四步：按优先级匹配输入，捕获文本片段，转换人称，再把片段填入随机模板。它并不理解“压力”“妈妈”或对话因果。即使加入 `memory`，保存的也只是明确提取的键值，并不是对语义的建模。

规则系统在表单校验、风控阈值、协议编排等封闭场景仍然很有价值，因为其行为可审计。但开放对话会遇到组合爆炸：词汇、句式、上下文和例外的组合远多于规则作者能枚举的范围。

## 2.3 从学习到 LLM Agent

强化学习将交互抽象为 `(state, action, reward, nextState)`：智能体选择行动，环境返回新状态和奖励，目标是最大化长期累计回报。LLM 预训练则从海量文本中学习下一个 token 的概率分布。今天常见的 Agent 将它们组合：

```text
用户/工具结果 -> LLM 推理与规划 -> 受限工具执行 -> 新观察
                         |                    |
                    短期/长期记忆         权限、预算、日志
```

模型提供语言理解与候选行动，工程系统提供事实来源、执行能力和安全边界。这也是第一章中“模型不等于 Agent”的另一种表述。

## 2.4 练习

1. 为 ELIZA 添加“学习”和“工作”两条高优先级规则，并说明它们为何可能冲突。
2. 用 `Map` 保存用户说过的职业和爱好，观察哪些句式仍无法可靠提取。
3. 为 `respond` 写三个单元测试：特定规则、兜底规则、名字记忆。
4. 列出一个需要规则系统而不是 Agent 的业务流程，并给出可验证的验收条件。
