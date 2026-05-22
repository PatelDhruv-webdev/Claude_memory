import { existsSync } from "node:fs";
import { readFile, rename } from "node:fs/promises";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { writeFileAtomic } from "../util/atomic.js";
import { configPath } from "../util/paths.js";
import { ConfigError } from "../util/errors.js";
import { ConfigSchema, DEFAULT_CONFIG, type Config } from "./schema.js";

const HEADER = `# continuum config
# Generated automatically by 'continuum'.
# Edit with 'continuum config' or directly. Re-run 'continuum reinstall' to redo provider setup.
`;

export async function loadConfig(path: string = configPath()): Promise<Config | null> {
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    throw new ConfigError(
      `Could not read config at ${path}: ${(err as Error).message}`,
      "Check file permissions, then run `continuum reinstall`.",
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    await backupBroken(path, `parse error: ${(err as Error).message}`);
    return null;
  }

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    await backupBroken(
      path,
      `schema mismatch: ${result.error.issues.map((i) => i.message).join("; ")}`,
    );
    return null;
  }
  return result.data;
}

export async function saveConfig(config: Config, path: string = configPath()): Promise<void> {
  const validated = ConfigSchema.parse(config);
  const body = HEADER + "\n" + stringifyYaml(validated);
  await writeFileAtomic(path, body);
}

export function defaultConfig(): Config {
  // Defensive clone so callers don't mutate the shared constant.
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

async function backupBroken(path: string, reason: string): Promise<void> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${path}.broken-${ts}`;
  try {
    await rename(path, backup);
    process.stderr.write(
      `continuum: config at ${path} was unusable (${reason}). ` +
        `Backed up to ${backup}; will regenerate on next run.\n`,
    );
  } catch {
    // If we can't even back it up, leave it alone — caller will try to overwrite.
  }
}
