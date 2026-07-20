# 第三章 大语言模型基础：Node.js 实践

对应原教程：`docs/chapter3/第三章 大语言模型基础.md`。

本章不尝试在 Node.js 中训练一个 Transformer，而是用小型 JavaScript 实验解释语言模型的关键计算，并用 SDK 调用实际模型。训练大型模型需要 GPU 框架；Node.js 更适合作为 Agent 的编排、服务与工具执行层。

## 3.1 从 N-gram 到词向量

语言模型估计序列的概率。Bigram 近似把一个句子的概率拆成：

`P(datawhale agent learns) ~= P(datawhale) * P(agent | datawhale) * P(learns | agent)`。

保存以下代码为 `ngram.js`：

```js
const tokens = "datawhale agent learns datawhale agent works".split(" ");

function count(items) {
  return items.reduce((map, item) => map.set(item, (map.get(item) ?? 0) + 1), new Map());
}

const unigram = count(tokens);
const bigrams = count(tokens.slice(0, -1).map((word, i) => `${word}\u0001${tokens[i + 1]}`));

function pWord(word) {
  return (unigram.get(word) ?? 0) / tokens.length;
}

function pNext(next, previous) {
  return (bigrams.get(`${previous}\u0001${next}`) ?? 0) / (unigram.get(previous) ?? 1);
}

const probability = pWord("datawhale") * pNext("agent", "datawhale") * pNext("learns", "agent");
console.log({
  pDatawhale: pWord("datawhale"),
  pAgentGivenDatawhale: pNext("agent", "datawhale"),
  pLearnsGivenAgent: pNext("learns", "agent"),
  probability,
});
```

运行 `node ngram.js`。它的局限也很直接：没在语料中出现的组合概率为零，而且它不知道 `agent` 与 `robot` 的语义相近。

词嵌入把离散词映射到连续向量。下面演示余弦相似度和经典类比的数学操作；向量数值是人为构造的，不是训练结果：

```js
const embeddings = {
  king: [0.9, 0.8], queen: [0.9, 0.2],
  man: [0.7, 0.9], woman: [0.7, 0.3],
};

const add = (a, b) => a.map((x, i) => x + b[i]);
const subtract = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const norm = (a) => Math.sqrt(dot(a, a));
const cosine = (a, b) => dot(a, b) / (norm(a) * norm(b));

const result = add(subtract(embeddings.king, embeddings.man), embeddings.woman);
console.log("king - man + woman =", result);
console.log("与 queen 的余弦相似度 =", cosine(result, embeddings.queen));
```

## 3.2 Transformer 为什么适合长文本

Transformer 的注意力机制让一个 token 可以按相关性聚合序列中其他 token 的信息。缩放点积注意力为：

`Attention(Q, K, V) = softmax(QK^T / sqrt(d_k)) V`

以下是单个 query 的教学实现，不包含训练、批次或多头：

```js
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const softmax = (xs) => {
  const max = Math.max(...xs);
  const exps = xs.map((x) => Math.exp(x - max));
  const total = exps.reduce((a, b) => a + b, 0);
  return exps.map((x) => x / total);
};

function attention(query, keys, values) {
  const scale = Math.sqrt(query.length);
  const weights = softmax(keys.map((key) => dot(query, key) / scale));
  const output = values[0].map((_, dimension) =>
    weights.reduce((sum, weight, i) => sum + weight * values[i][dimension], 0),
  );
  return { weights, output };
}

const query = [1, 0];
const keys = [[1, 0], [0, 1], [0.8, 0.1]];
const values = [[10, 0], [0, 20], [8, 1]];
console.log(attention(query, keys, values));
```

真实模型将 token 变为向量，堆叠多层多头注意力与前馈网络，并借助位置编码保留词序。GPT 类模型采用 decoder-only 架构，以“预测下一个 token”为训练目标，因此特别适合续写与对话。

## 3.3 Token、提示与上下文

模型处理 token 而非“字”或“词”。中文、英文、空格、代码片段都会被分成不等数量的 token，故上下文限制和计费应按模型实际 tokenizer 计算。一个稳定的 Agent 提示通常区分：

```text
System：角色、不可违反的安全规则、工具使用边界
Developer：产品策略、输出结构、评价标准
User：当前目标和输入数据
Tool：外部工具产生的事实结果
```

提示不是安全边界。执行权限、参数校验、网络访问控制和人工确认必须由代码实现。

## 3.4 调用 OpenAI 兼容模型

先按 README 安装 `openai dotenv` 并配置 `.env`。保存为 `chat.js`：

```js
import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.LLM_API_KEY,
  baseURL: process.env.LLM_BASE_URL || undefined,
});

const response = await client.chat.completions.create({
  model: process.env.LLM_MODEL,
  temperature: 0.2,
  messages: [
    { role: "system", content: "你是严谨的 Node.js 助手。答案简洁，未知内容明确说明。" },
    { role: "user", content: "用三句话说明 Transformer 的自注意力。" },
  ],
});

console.log(response.choices[0]?.message?.content);
```

执行 `node chat.js`。生产代码还应检查 `choices[0]`、处理 429/5xx、设置超时与重试、记录请求 ID，并限制用户可控输入的长度。

## 3.5 模型选择与局限

不要只按参数量选择模型。先用目标任务的真实样本评估质量、上下文长度、延迟、成本、结构化输出和工具调用可靠性。模型会产生幻觉：它生成的是看似合理的 token 序列，不保证陈述来自可信事实。对实时或高风险结论，应通过检索、数据库、受控工具或人工审核验证。

## 3.6 练习

1. 给 N-gram 增加加一平滑，比较未出现 bigram 的概率变化。
2. 修改注意力示例，使 query 更接近第二个 key，并解释权重变化。
3. 为 `chat.js` 增加 `AbortSignal.timeout(20_000)` 和指数退避重试。
4. 设计一个要求模型输出 JSON 的提示，并在 Node.js 中用 JSON Schema 校验返回值。
