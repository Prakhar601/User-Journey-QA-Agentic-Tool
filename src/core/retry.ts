export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  maxAttempts: number = 2
): Promise<T> {
  if (maxAttempts < 1) {
    throw new Error("maxAttempts must be at least 1");
  }

  let attempt = 0;
  let originalError: unknown;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    // eslint-disable-next-line no-console
    console.log(`Attempt ${attempt}/${maxAttempts} started...`);

    try {
      const result: T = await operation();
      return result;
    } catch (error) {
      const message: string =
        error instanceof Error ? error.message : String(error);

      if (
        attempt === 1 &&
        maxAttempts > 1 &&
        isTransientErrorMessage(message)
      ) {
        if (originalError === undefined) {
          originalError = error;
        }
        // eslint-disable-next-line no-console
        console.log("Execution attempt failed, retrying once...");
        // eslint-disable-next-line no-console
        console.log("Retrying execution...");
        if (attempt < maxAttempts) {
          continue;
        }
      }

      if (originalError === undefined) {
        originalError = error;
      }

      if (attempt >= maxAttempts) {
        // eslint-disable-next-line no-console
        console.log("Execution failed after retry.");
      }

      throw normalizeError(originalError);
    }

    if (attempt >= maxAttempts) {
      throw normalizeError(originalError);
    }
  }
}

function isTransientErrorMessage(message: string): boolean {
  const lower: string = message.toLowerCase();

  const nonTransientKeywords: string[] = [
    "invalid credentials",
    "authentication failed",
    "invalid workflow",
    "json parse",
    "budget exceeded",
    "403",
  ];

  if (nonTransientKeywords.some((keyword) => lower.includes(keyword))) {
    return false;
  }

  const transientKeywords: string[] = [
    "timeout",
    "network",
    "connection",
    "temporarily",
    "rate limit",
  ];

  return transientKeywords.some((keyword) => lower.includes(keyword));
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

