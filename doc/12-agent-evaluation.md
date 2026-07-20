# 第十二章 智能体性能评估：Node.js 实践

对应原教程：`docs/chapter12/第十二章 智能体性能评估.md`。评估不是一次“看起来不错”的演示，而是可重复执行的任务集、确定义的评分器、分组指标、失败样本和版本对比。

## 12.1 评什么

Agent 评测至少分为四层：

| 层次 | 指标示例 |
| --- | --- |
| 最终结果 | 任务成功率、精确匹配、人工偏好 |
| 工具调用 | 工具选择、参数准确率、调用顺序 |
| 运行质量 | 延迟、token、调用次数、成本、重试率 |
| 安全与鲁棒性 | 越权率、注入攻击成功率、错误恢复率 |

BFCL 强调函数调用的准确性，GAIA 强调多步骤通用助手任务。使用公开基准时应遵循其官方数据格式和评分脚本；同时一定要有贴近自身产品的私有保留集。

## 12.2 一个函数调用评测器

保存为 `tool-evaluator.js`。它先对 JSON 参数做稳定排序，再比较函数名与参数。真实基准可能定义了更复杂的等价关系，应以其官方评测器为准。

```js
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function sameCall(actual, expected) {
  if (actual.name !== expected.name) return false;
  return JSON.stringify(canonical(actual.arguments)) === JSON.stringify(canonical(expected.arguments));
}

export function evaluateToolCalls(cases, predict) {
  const results = cases.map((test) => {
    const actual = predict(test.prompt, test.tools);
    return { id: test.id, expected: test.expected, actual, passed: sameCall(actual, test.expected) };
  });
  return { accuracy: results.filter((r) => r.passed).length / results.length, results };
}

const cases = [{
  id: "add-1", prompt: "计算 2 加 3", tools: ["add"],
  expected: { name: "add", arguments: { a: 2, b: 3 } },
}];
console.log(evaluateToolCalls(cases, () => ({ name: "add", arguments: { b: 3, a: 2 } })));
```

评测生产 Agent 时，`predict` 应为异步调用，并保存原始模型响应、解析错误和工具轨迹。不要只保存“通过/失败”，否则无法做错误分析。

## 12.3 任务集与回归测试

每条任务应包含稳定 ID、输入、允许工具、期望结果或评分规则、难度标签、风险标签和版本。下面是一个 JSONL 记录形状：

```json
{"id":"refund-001","input":"下载数字内容后可以退款吗？","expected":{"mustCite":"policy-v1#1","contains":"不支持"},"tags":["rag","policy","zh"],"risk":"medium"}
```

将任务按特性、语言、难度、工具和风险分层汇报。总体成功率上升不代表高风险子集没有退化。版本比较应固定任务集、模型参数、工具版本和评分器版本。

## 12.4 评估运行器与报告

以下工具将异步 Agent 的结果和基础运行指标写成可比较记录：

```js
export async function evaluate(cases, agent) {
  const results = [];
  for (const test of cases) {
    const started = performance.now();
    try {
      const output = await agent.run(test.input);
      const passed = test.score(output); // 每种任务可注入确定性评分器
      results.push({ id: test.id, passed, latencyMs: performance.now() - started, output });
    } catch (error) {
      results.push({ id: test.id, passed: false, latencyMs: performance.now() - started, error: error.message });
    }
  }
  const passed = results.filter((result) => result.passed).length;
  return { total: results.length, successRate: passed / results.length, results };
}
```

建立发布门槛，例如“高风险集不得下降、总体成功率不低于基线、p95 延迟在预算内、注入集零越权”。模型评分用于开放文本质量时，应使用盲评、固定 rubric、对换回答顺序，并抽样人工复核其偏差。

## 12.5 练习

1. 为 `sameCall` 增加数值容差和可选字段规则。
2. 编写一个 20 条的私有任务集，覆盖成功、失败、超时与注入输入。
3. 为评估器生成按 `tags` 分组的成功率报告。
4. 设计一个 CI 发布门槛，说明何时阻止发布、何时需要人工审核。
