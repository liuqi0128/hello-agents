# 第十五章 构建赛博小镇：Node.js Agent 服务

对应原教程：`docs/chapter15/第十五章 构建赛博小镇.md`。原教程使用 Godot 前端；本章聚焦可供 Godot、Web 或移动端连接的 Node.js NPC 服务。NPC 系统应将角色设定、记忆、好感度和实时状态分开存储。

## 15.1 NPC 状态模型

```js
import { z } from "zod";

export const npcSchema = z.object({
  id: z.string(), name: z.string(), persona: z.string(),
  affinity: z.number().int().min(-100).max(100).default(0),
  memories: z.array(z.object({ content: z.string(), importance: z.number(), createdAt: z.string() })).default([]),
});

export function affinityLevel(value) {
  if (value >= 60) return "close";
  if (value >= 20) return "friendly";
  if (value <= -30) return "guarded";
  return "neutral";
}
```

好感度不是模型自由输出的数字。应由确定性规则基于事件类型、角色边界和冷却时间计算，避免提示注入或一次对话把关系推到极端。

## 15.2 对话与记忆更新

每轮对话的输入由角色设定、有限的相关记忆、当前好感度等级和玩家消息组成。模型输出经过 Schema 校验后才写入记忆：

```js
export function applyInteraction(npc, event) {
  const changes = { gift: 8, help: 5, insult: -12, neutral: 0 };
  const delta = changes[event.type] ?? 0;
  const affinity = Math.max(-100, Math.min(100, npc.affinity + delta));
  const memories = event.remember
    ? [...npc.memories, { content: event.summary, importance: Math.min(1, Math.abs(delta) / 10 + 0.3), createdAt: new Date().toISOString() }]
    : npc.memories;
  return { ...npc, affinity, memories: memories.slice(-100) };
}

export function buildNpcContext(npc, playerMessage) {
  const memories = [...npc.memories].sort((a, b) => b.importance - a.importance).slice(0, 5);
  return {
    system: `你是${npc.name}。角色设定：${npc.persona}。当前关系：${affinityLevel(npc.affinity)}。保持角色边界，不编造游戏事实。`,
    user: playerMessage,
    memories: memories.map((m) => m.content),
  };
}
```

先将模型回复和“是否值得记忆”的判断分开。高频闲聊不应无限增长记忆；可在后台定期总结低价值的旧事件，保留原始记录的审计链。

## 15.3 实时状态与批量生成

实时玩家对话应走低延迟路径；背景对话、日记、关系总结等可走队列/定时任务。使用 WebSocket 或 SSE 广播 NPC 状态变更，但不要通过 socket 接收未验证的管理命令。

```js
// 概念性事件：将持久化后的状态发送给订阅该小镇房间的客户端。
function broadcastNpcUpdate(io, townId, npc) {
  io.to(`town:${townId}`).emit("npc.updated", {
    id: npc.id, affinity: npc.affinity, affinityLevel: affinityLevel(npc.affinity),
  });
}
```

批量生成应有并发上限、任务去重、模型预算和失败重试。不要让每个 NPC 在每个 tick 都调用模型，这既昂贵也会造成状态竞争。

## 15.4 练习

1. 为 NPC 事件增加 `playerId`、`townDay` 和幂等键。
2. 为一个角色设计不允许讨论的敏感话题及对应的确定性拦截器。
3. 将记忆保存在 SQLite/PostgreSQL，并实现玩家删除与导出。
4. 制定后台生成任务的并发、预算和失败告警策略。
