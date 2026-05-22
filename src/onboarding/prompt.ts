import { createInterface, type Interface } from "node:readline";

/**
 * Minimal prompt helpers. Abstracted so tests can inject answers.
 */
export interface Prompter {
  ask(question: string): Promise<string>;
  askSecret(question: string): Promise<string>;
  askChoice(question: string, choices: string[], defaultIndex?: number): Promise<number>;
  askYesNo(question: string, defaultYes: boolean): Promise<boolean>;
  close(): void;
}

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export function makeReadlinePrompter(): Prompter {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return {
    ask: (q) => askLine(rl, q),
    askSecret: (q) => askSecret(rl, q),
    askChoice: async (q, choices, def) => {
      process.stdout.write(q + "\n");
      choices.forEach((c, i) => process.stdout.write(`  ${i + 1}) ${c}\n`));
      const defaultLabel = def !== undefined ? ` [${def + 1}]` : "";
      for (;;) {
        const raw = (await askLine(rl, `Choice${defaultLabel}: `)).trim();
        if (raw === "" && def !== undefined) return def;
        const n = Number.parseInt(raw, 10);
        if (Number.isInteger(n) && n >= 1 && n <= choices.length) return n - 1;
        process.stdout.write(`  Please enter a number 1-${choices.length}.\n`);
      }
    },
    askYesNo: async (q, defaultYes) => {
      const suffix = defaultYes ? " [Y/n] " : " [y/N] ";
      const raw = (await askLine(rl, q + suffix)).trim().toLowerCase();
      if (raw === "") return defaultYes;
      return raw === "y" || raw === "yes";
    },
    close: () => rl.close(),
  };
}

function askLine(rl: Interface, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, resolve));
}

/**
 * Ask for a secret without echoing. Falls back to plain ask if stdin
 * isn't a TTY.
 */
function askSecret(rl: Interface, q: string): Promise<string> {
  if (!process.stdin.isTTY) return askLine(rl, q);
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const onData = (char: Buffer) => {
      const s = char.toString("utf8");
      // Don't echo; readline will print its own newline at the end
      if (s === "\n" || s === "\r" || s === "\r\n") {
        stdin.removeListener("data", onData);
      } else {
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
    rl.question(q, (answer) => {
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}
