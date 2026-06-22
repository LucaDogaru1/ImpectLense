import { stripAnsi } from "../formatting/text";

export interface ReportLogger {
    log: (message?: string) => void;
    toText: () => string;
}

export function createReportLogger(): ReportLogger {
    const lines: string[] = [];

    function log(message: string = ""): void {
        console.log(message);
        lines.push(stripAnsi(message));
    }

    function toText(): string {
        return lines.join("\n");
    }

    return { log, toText };
}

