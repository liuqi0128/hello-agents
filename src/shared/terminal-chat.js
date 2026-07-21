import boxen from "boxen";
import chalk from "chalk";
import ora from "ora";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const EXIT_RE = /^(exit|quit|q|退出)$/i;

function formatJson(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * 可复用的终端对话 UI。
 * 各阶段 agent 只负责业务逻辑，展示与输入循环交给这里。
 */
export function createTerminalChat({
  title,
  subtitle = "",
  agentName = "助手",
  promptLabel = "你",
  tip = "输入 exit / quit / 退出 结束对话",
} = {}) {
  const name = agentName;

  function showBanner() {
    const lines = [chalk.bold.cyan(title)];
    if (subtitle) lines.push(chalk.dim(subtitle));
    if (tip) lines.push(chalk.dim(tip));

    console.log(
      boxen(lines.join("\n"), {
        padding: 1,
        margin: { top: 1, bottom: 1, left: 0, right: 0 },
        borderStyle: "round",
        borderColor: "cyan",
      }),
    );
  }

  function printDivider() {
    console.log(chalk.dim("─".repeat(48)));
  }

  function printUser(text) {
    console.log(`${chalk.bold.green(promptLabel)}  ${text}`);
  }

  function printAssistant(text) {
    console.log(`${chalk.bold.cyan(name)}  ${text ?? ""}`);
  }

  function printTool(toolName, result) {
    const body = chalk.dim(formatJson(result));
    console.log(
      boxen(`${chalk.yellow(`⚙ ${toolName}`)}\n${body}`, {
        padding: { top: 0, bottom: 0, left: 1, right: 1 },
        margin: { top: 0, bottom: 0, left: 2, right: 0 },
        borderStyle: "round",
        borderColor: "yellow",
        dimBorder: true,
      }),
    );
  }

  function printError(message) {
    console.log(`${chalk.bold.red("错误")}  ${message}`);
  }

  function printInfo(message) {
    console.log(chalk.dim(message));
  }

  async function withSpinner(label, task) {
    const spinner = ora({ text: label, color: "cyan" }).start();
    try {
      const result = await task();
      spinner.stop();
      return result;
    } catch (error) {
      spinner.fail(chalk.red(`${label.replace(/…$/, "")}失败`));
      throw error;
    }
  }

  /**
   * @param {(userText: string, ui: ReturnType<typeof createTerminalChat>) => Promise<void>} onMessage
   */
  async function runLoop(onMessage) {
    showBanner();
    const rl = readline.createInterface({ input, output });
    const ui = {
      showBanner,
      printDivider,
      printUser,
      printAssistant,
      printTool,
      printError,
      printInfo,
      withSpinner,
      runLoop,
    };

    try {
      while (true) {
        const userInput = (await rl.question(`${chalk.bold.green(promptLabel)}  `)).trim();
        if (EXIT_RE.test(userInput)) {
          printInfo("\n对话已结束。\n");
          break;
        }
        if (!userInput) continue;

        try {
          await onMessage(userInput, ui);
        } catch (error) {
          printError(error.message ?? String(error));
        }
        console.log();
      }
    } finally {
      rl.close();
    }
  }

  return {
    showBanner,
    printDivider,
    printUser,
    printAssistant,
    printTool,
    printError,
    printInfo,
    withSpinner,
    runLoop,
  };
}
