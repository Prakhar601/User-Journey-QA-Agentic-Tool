import { loadEnvFile } from "./ai/loadEnv";
import { runBenchmark } from "./benchmark/runBenchmark";

loadEnvFile();

async function main(): Promise<void> {
  try {
    await runBenchmark();
    process.exit(0);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Benchmark failed:", err);
    process.exit(1);
  }
}

void main();
