import fs from "node:fs";
import {
    classifyTicket,
    formatClassificationMarkdown,
} from "../../analyzers/ticket/ticketClassification";
import { getOptionValue, hasFlag } from "../shared/cliArgs";
import { readTicketFile, resolveTicketPath, TICKET_INPUT_HELP } from "../shared/ticketInput";

const args = process.argv.slice(2);
const ticketPath = resolveTicketPath(args);
const jsonOutput = hasFlag(args, "--json") || !hasFlag(args, "--markdown");
const outputPath = getOptionValue(args, "--output");

if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log([
        "Usage: impactlens ticket:classify [ticket.txt] [options]",
        "",
        "Classify ticket text before analyze:ticket. The agent should read this output,",
        "decide ticket_topic / change_includes / scopes, then pass them to analyze:ticket.",
        "",
        TICKET_INPUT_HELP,
        "",
        "Options:",
        "  --json            JSON output (default)",
        "  --markdown        Markdown output with suggested analyze:ticket flags",
        "  --output=path     Write output to file",
    ].join("\n"));
    process.exit(0);
}

const { text: ticketText } = readTicketFile(ticketPath);

if (ticketText.trim().length === 0) {
    console.log([
        "No ticket file provided.",
        "",
        TICKET_INPUT_HELP,
    ].join("\n"));
    process.exit(2);
}

const classification = classifyTicket(ticketText);

if (jsonOutput) {
    const outputJson = JSON.stringify(classification, null, 2);
    console.log(outputJson);
    if (outputPath) {
        fs.writeFileSync(outputPath, outputJson, "utf8");
    }
} else {
    const markdown = formatClassificationMarkdown(classification);
    console.log(markdown);
    if (outputPath) {
        fs.writeFileSync(outputPath, markdown, "utf8");
    }
}
