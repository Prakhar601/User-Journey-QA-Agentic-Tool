import { spawn } from "child_process";
import * as path from "path";
import { validateBrowserState } from "../core/validateBrowserState";

export interface PythonAgentOptions {
  url: string;
  username: string;
  password: string;
  instruction: string;
  /**
   * Optional explicit Python executable path. When omitted, the runner will
   * fall back to process.env.PYTHON_PATH and then to "python".
   */
  pythonExecutablePath?: string;
}

export interface PythonBrowserState {
  url: string;
  title: string;
  dom_snapshot: string;
  // The following collections are intentionally typed as unknown[] to keep
  // the adapter generic; downstream code can refine as needed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buttons: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputs: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  links: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  network_logs: any[];
}

export async function runPythonAgent(
  options: PythonAgentOptions
): Promise<PythonBrowserState> {
  const scriptPath: string = path.resolve(
    process.cwd(),
    "python-agent",
    "browser_agent.py"
  );

  const args: string[] = [
    scriptPath,
    "--url",
    options.url,
    "--username",
    options.username,
    "--password",
    options.password,
    "--instruction",
    options.instruction,
  ];

  const resolvePythonPath = (): string => {
    const envPath: string | undefined =
      typeof process.env.PYTHON_PATH === "string"
        ? process.env.PYTHON_PATH.trim()
        : undefined;
    if (envPath && envPath.length > 0) {
      return envPath;
    }

    const configPath: string | undefined =
      typeof options.pythonExecutablePath === "string"
        ? options.pythonExecutablePath.trim()
        : undefined;
    if (configPath && configPath.length > 0) {
      return configPath;
    }

    return "python";
  };

  const spawnPython = (pythonPath: string) =>
    spawn(pythonPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
      },
    });

  return new Promise<PythonBrowserState>((resolve, reject) => {
    let pythonPath: string = resolvePythonPath();
    let child = spawnPython(pythonPath);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("error", (error: Error & { code?: string }) => {
      if (error && error.code === "ENOENT" && pythonPath !== "python") {
        // eslint-disable-next-line no-console
        console.warn(
          `Python executable not found at "${pythonPath}". Falling back to "python".`
        );
        pythonPath = "python";
        child = spawnPython(pythonPath);

        stdout = "";
        stderr = "";

        child.stdout.on("data", (data: Buffer) => {
          stdout += data.toString();
        });

        child.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        child.on("error", (fallbackError: Error) => {
          reject(fallbackError);
        });

        child.on("close", (code: number | null) => {
          if (code !== 0) {
            // eslint-disable-next-line no-console
            console.error("===== PYTHON STDERR BEGIN =====");
            // eslint-disable-next-line no-console
            console.error(stderr);
            // eslint-disable-next-line no-console
            console.error("===== PYTHON STDERR END =====");
            reject(
              new Error(stderr || `Python agent exited with code ${code}`)
            );
            return;
          }

          const trimmed: string = stdout.trim();
          if (trimmed.length === 0) {
            reject(new Error("Python agent returned empty stdout."));
            return;
          }

          let parsed: unknown;
          try {
            parsed = JSON.parse(trimmed) as unknown;
          } catch (error) {
            reject(
              new Error(
                `Failed to parse Python agent JSON output: ${
                  (error as Error).message
                }\nRaw output:\n${trimmed}`
              )
            );
            return;
          }

          const validation = validateBrowserState(parsed);
          if (!validation.valid) {
            reject({
              error: true,
              message: "Browser state validation failed",
              details: validation.errors,
            });
            return;
          }

          const state: PythonBrowserState = parsed as PythonBrowserState;
          resolve(state);
        });

        return;
      }

      reject(error);
    });

    child.on("close", (code: number | null) => {
      if (code !== 0) {
        // eslint-disable-next-line no-console
        console.error("===== PYTHON STDERR BEGIN =====");
        // eslint-disable-next-line no-console
        console.error(stderr);
        // eslint-disable-next-line no-console
        console.error("===== PYTHON STDERR END =====");
        reject(new Error(stderr || `Python agent exited with code ${code}`));
        return;
      }

      const trimmed: string = stdout.trim();
      if (trimmed.length === 0) {
        reject(new Error("Python agent returned empty stdout."));
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed) as unknown;
      } catch (error) {
        reject(
          new Error(
            `Failed to parse Python agent JSON output: ${
              (error as Error).message
            }\nRaw output:\n${trimmed}`
          )
        );
        return;
      }

      const validation = validateBrowserState(parsed);
      if (!validation.valid) {
        reject({
          error: true,
          message: "Browser state validation failed",
          details: validation.errors,
        });
        return;
      }

      const state: PythonBrowserState = parsed as PythonBrowserState;
      resolve(state);
    });
  });
}

