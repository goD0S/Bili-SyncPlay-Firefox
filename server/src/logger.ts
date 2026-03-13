import type { LogEvent } from "./types";

export function createStructuredLogger(writeLine?: (line: string) => void): LogEvent {
  return (event, data) => {
    (writeLine ?? console.log)(
      JSON.stringify({
        event,
        timestamp: new Date().toISOString(),
        ...data
      })
    );
  };
}
