import Parser from "tree-sitter";
import { WalkContext } from "../../walk/context";
import { graph } from "../../../../graph/graph";
import { cleanPhpString } from "../../semantic/fieldNodes";
import { linkConfigFileLiteral } from "./configReference";

const QUEUE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+){2,}$/i;
const SQS_ARN_PATTERN = /^arn:aws:sqs:[a-z0-9-]+:\d+:[a-z0-9-]+$/i;

export function configLiteralType(
    node: Parser.SyntaxNode,
    context: WalkContext,
    file: string
): void {
    const raw = cleanPhpString(node.text);
    if (!raw || raw.length < 5) return;

    const literals = extractLiteralCandidates(raw);
    if (literals.length === 0) return;

    for (const literal of literals) {
        const id = `config_literal:${literal}`;

        graph.nodes.set(id, {
            id,
            type: "config_literal",
            name: literal,
            file,
            parent: context.currentMethod ?? context.currentClass,
            keywords: ["config", "literal", "queue", "sqs", literal],
        });

        if (context.currentMethod) {
            graph.edges.set(`${context.currentMethod}->${id}`, {
                from: context.currentMethod,
                to: id,
                type: "REFERENCES",
                confidence: 0.85,
                reason: "Method references config/queue literal",
            });
        } else if (context.currentClass) {
            graph.edges.set(`${context.currentClass}->${id}`, {
                from: context.currentClass,
                to: id,
                type: "REFERENCES",
                confidence: 0.85,
                reason: "Class references config/queue literal",
            });
        }

        linkConfigFileLiteral(id, literal, file);
    }
}

function extractLiteralCandidates(raw: string): string[] {
    const result = new Set<string>();

    if (SQS_ARN_PATTERN.test(raw)) {
        const queueName = raw.split(":").pop();
        if (queueName) result.add(queueName);
        result.add(raw);
        return [...result];
    }

    if (QUEUE_NAME_PATTERN.test(raw) && /queue|sqs|expired|object|consumer|prod|dev/i.test(raw)) {
        result.add(raw);
    }

    if (/sqs/i.test(raw) && raw.includes("-") && !/your-|example|placeholder|changeme/i.test(raw)) {
        result.add(raw);
    }

    return [...result];
}
