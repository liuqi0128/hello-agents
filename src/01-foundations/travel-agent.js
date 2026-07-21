import OpenAI from "openai";
import { createTerminalChat } from "../shared/terminal-chat.js";

const apiKey = process.env.LLM_API_KEY?.trim();
const baseURL = process.env.LLM_BASE_URL?.trim();
const model = process.env.LLM_MODEL?.trim();

if (!apiKey || !model) {
  throw new Error("请在 .env 中配置 LLM_API_KEY 和 LLM_MODEL。");
}

const client = new OpenAI({
  apiKey,
  baseURL: baseURL || undefined,
});

async function getWeather({ city }) {
  const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const current = data.current_condition?.[0];
    if (!current) throw new Error("响应中没有当前天气");

    return {
      city,
      condition: current.weatherDesc?.[0]?.value ?? "未知",
      temperatureC: Number(current.temp_C),
      humidity: Number(current.humidity),
    };
  } catch (error) {
    return { city, error: `查询天气失败：${error.message}` };
  }
}

function getAttraction({ city, weather }) {
  const suggestions = {
    北京: {
      rain: "故宫博物院、国家博物馆等室内场馆",
      default: "颐和园、天坛公园或长城（注意防晒和交通时间）",
    },
  };
  const entry = suggestions[city] ?? {
    rain: "当地博物馆、美术馆或大型室内展馆",
    default: "当地公园、历史街区或城市地标",
  };
  const rainy = /rain|雨|雷暴/i.test(weather);
  return { city, weather, recommendation: rainy ? entry.rain : entry.default };
}

function getTransport({ city, weather }) {
  const suggestions = {
    北京: {
      rain: "优先乘坐地铁，短途可打车，避免骑行",
      default: "优先乘坐地铁，短途可步行或骑共享单车",
    },
  };
  const entry = suggestions[city] ?? {
    rain: "优先乘坐地铁、公交或出租车，避免骑行",
    default: "优先乘坐公共交通，短途可步行或骑行",
  };
  const rainy = /rain|雨|雷暴/i.test(weather);
  return { city, weather, recommendation: rainy ? entry.rain : entry.default };
}

const tools = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "查询一个城市当前天气。涉及实时天气时必须先调用它。",
      parameters: {
        type: "object",
        properties: { city: { type: "string", description: "城市名称，例如 北京" } },
        required: ["city"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_attraction",
      description: "根据城市和天气给出旅游景点建议。必须在已得到天气后调用。",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string" },
          weather: { type: "string", description: "get_weather 返回的 condition" },
        },
        required: ["city", "weather"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_transport",
      description: "根据城市和天气推荐合适的交通工具。必须在已得到天气后调用。",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string" },
          weather: { type: "string", description: "get_weather 返回的 condition" },
        },
        required: ["city", "weather"],
        additionalProperties: false,
      },
    },
  },
];

const implementations = {
  get_weather: getWeather,
  get_attraction: getAttraction,
  get_transport: getTransport,
};

const messages = [
  {
    role: "system",
    content:
      "你是可靠的旅行助手。根据工具结果回答；不要编造实时天气。缺少城市、日期或关键偏好时，先简洁追问用户。工具发生错误时，如实说明。",
  },
];

const ui = createTerminalChat({
  title: "旅游助手 · 01 Foundations",
  subtitle: "模型调用 + 工具调用入门",
  agentName: "旅游助手",
  promptLabel: "用户",
});

async function respondToUser() {
  for (let turn = 0; turn < 6; turn += 1) {
    const completion = await ui.withSpinner("正在思考…", () =>
      client.chat.completions.create({
        model,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.2,
      }),
    );

    const assistant = completion.choices[0]?.message;
    if (!assistant) throw new Error("模型没有返回消息");
    messages.push(assistant);

    if (!assistant.tool_calls?.length) {
      ui.printAssistant(assistant.content ?? "");
      return;
    }

    for (const call of assistant.tool_calls) {
      if (call.type !== "function") continue;
      const run = implementations[call.function.name];
      let result;
      try {
        const args = JSON.parse(call.function.arguments);
        result = run ? await run(args) : { error: `未知工具：${call.function.name}` };
      } catch (error) {
        result = { error: `工具参数无效：${error.message}` };
      }
      ui.printTool(call.function.name, result);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  ui.printAssistant("本轮工具调用次数已达到上限，请换一种说法或补充信息。");
}

await ui.runLoop(async (userInput) => {
  messages.push({ role: "user", content: userInput });
  await respondToUser();
});
