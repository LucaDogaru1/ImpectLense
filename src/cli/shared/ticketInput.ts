import fs from "node:fs";
import path from "node:path";
import { getOptionValue } from "./cliArgs";

function firstPositionalTicketArg(args: string[]): string | undefined {
    for (const arg of args) {
        if (arg.startsWith("-")) {
            continue;
        }

        return arg;
    }

    return undefined;
}

/** Resolve ticket path from CLI flags, positional arg, or npm_config_ticket. */
export function resolveTicketPath(args: string[]): string | undefined {
    const fromFlag = getOptionValue(args, "--ticket")?.trim();
    if (fromFlag) {
        return fromFlag;
    }

    const fromPositional = firstPositionalTicketArg(args)?.trim();
    if (fromPositional) {
        return fromPositional;
    }

    const fromNpmConfig = process.env.npm_config_ticket?.trim();
    if (fromNpmConfig) {
        return fromNpmConfig;
    }

    return undefined;
}

export function readTicketFile(ticketPath: string | undefined): { text: string; source: string } {
    if (!ticketPath?.trim()) {
        return { text: "", source: "" };
    }

    const resolved = path.resolve(ticketPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        console.log(`Ticket file not found: ${ticketPath}`);
        process.exit(2);
    }

    return {
        text: fs.readFileSync(resolved, "utf8"),
        source: resolved,
    };
}

export const TICKET_INPUT_HELP = [
    "Ticket source (any one):",
    "  --ticket=path        Path to ticket text file",
    "  path/to/ticket.txt   Positional path (after -- when using npm run)",
    "",
    "npm run note: use `--` before flags, or pass the path positionally:",
    "  npm run classify:ticket -- tickets/fe-new.txt",
    "  npm run classify:ticket -- --ticket=tickets/fe-new.txt",
].join("\n");
