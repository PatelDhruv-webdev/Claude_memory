import { Command } from "commander";
import { snapshot } from "./snapshot/index.js";
import { DEFAULT_CONFIG } from "./config/schema.js";

const program = new Command();

program
  .name("continuum")
  .description(
    "Automatic session-handoff daemon for AI coding agents. " +
      "Watches your Claude Code session and produces HANDOFF.md when it ends.",
  )
  .version("0.1.0");

program
  .command("snapshot")
  .description("Produce HANDOFF.md and HANDOFF.diff for the current project now")
  .action(async () => {
    try {
      const result = await snapshot({
        cwd: process.cwd(),
        config: DEFAULT_CONFIG,
      });
      console.log(`✓ Wrote ${result.handoffPath}`);
      console.log(`✓ Wrote ${result.diffPath}`);
      console.log(`  Source: ${result.sourceFile}`);
    } catch (err) {
      console.error(`✗ ${(err as Error).message}`);
      process.exit(1);
    }
  });

const notYet = (name: string) => () => {
  console.error(`continuum ${name}: not implemented yet (coming in a later phase)`);
  process.exit(2);
};

program.command("start").description("Start the watcher daemon (Phase 4)").action(notYet("start"));
program.command("stop").description("Stop the watcher daemon (Phase 4)").action(notYet("stop"));
program.command("status").description("Show daemon status (Phase 4)").action(notYet("status"));
program.command("logs").description("Tail the daemon log (Phase 4)").action(notYet("logs"));
program.command("config").description("Open config in $EDITOR (Phase 2)").action(notYet("config"));
program.command("reinstall").description("Re-run Ollama / model install (Phase 2)").action(notYet("reinstall"));

program.action(async () => {
  // Default action: future = start daemon. For Phase 1, run a one-shot snapshot.
  try {
    const result = await snapshot({
      cwd: process.cwd(),
      config: DEFAULT_CONFIG,
    });
    console.log(`✓ Wrote ${result.handoffPath}`);
    console.log(`✓ Wrote ${result.diffPath}`);
    console.log(
      "\nNote: Phase 1 build — the daemon is not yet wired. " +
        "This run produced a one-shot snapshot.",
    );
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exit(1);
  }
});

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
