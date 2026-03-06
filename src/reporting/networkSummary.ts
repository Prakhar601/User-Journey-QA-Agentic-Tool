export function generateNetworkSummary(
  statusCode: number | null,
  responseTime: number | null
): string {
  if (statusCode == null) {
    return "Network response details were unavailable.";
  }

  if (statusCode >= 200 && statusCode <= 299) {
    if (responseTime != null) {
      if (responseTime < 1000) {
        return "The system responded successfully within normal time.";
      }
      if (responseTime <= 3000) {
        return "The system responded successfully but took slightly longer than expected.";
      }
      if (responseTime > 3000) {
        return "The system responded successfully but experienced noticeable delay.";
      }
    }

    return "The system responded successfully within normal time.";
  }

  if (statusCode >= 400 && statusCode <= 499) {
    return "The request was rejected due to client-side issue.";
  }

  if (statusCode >= 500 && statusCode <= 599) {
    return "The system encountered a server-side issue while processing the request.";
  }

  return "Network response details were unavailable.";
}

