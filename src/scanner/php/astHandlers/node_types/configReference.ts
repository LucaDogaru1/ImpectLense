import Parser from "tree-sitter";
import { graph } from "../../../../graph/graph";
import { WalkContext } from "../../walk/context";
import { cleanPhpString } from "../../semantic/fieldNodes";

export function configReferenceType(
    node: Parser.SyntaxNode,
    context: WalkContext
): void {
    const configKey = extractFirstStringArgument(node);
    if (!configKey) {
        return;
    }

    const configKeyId = `config_key:${configKey}`;

    graph.nodes.set(configKeyId, {
        id: configKeyId,
        type: "config_literal",
        name: configKey,
        file: context.currentClass ? graph.nodes.get(context.currentClass)?.file : undefined,
        parent: context.currentMethod ?? context.currentClass,
        keywords: ["config", "key", "queue", "sqs", configKey],
    });

    const from = context.currentMethod ?? context.currentClass;
    if (!from) {
        return;
    }

    graph.edges.set(`${from}->${configKeyId}`, {
        from,
        to: configKeyId,
        type: "REFERENCES",
        confidence: 0.9,
        reason: "Reads Laravel config key",
    });

    linkConfigKeyToKnownLiterals(configKeyId, configKey);
}

export function linkConfigFileLiteral(
    literalId: string,
    literalValue: string,
    file: string
): void {
    const configFileMatch = file.replace(/\\/g, "/").match(/\/config\/([a-z0-9_]+)\.php$/i);
    if (!configFileMatch) {
        return;
    }

    const configBase = configFileMatch[1];
    if (!/queue|sqs|expired|vod/i.test(literalValue)) {
        return;
    }

    const configKeyId = `config_key:${configBase}.queue`;

    graph.nodes.set(configKeyId, {
        id: configKeyId,
        type: "config_literal",
        name: `${configBase}.queue`,
        file,
        keywords: ["config", "key", "queue", configBase, literalValue],
    });

    graph.edges.set(`${configKeyId}->${literalId}`, {
        from: configKeyId,
        to: literalId,
        type: "REFERENCES",
        confidence: 0.95,
        reason: "Config file default queue value",
    });
}

function linkConfigKeyToKnownLiterals(configKeyId: string, configKey: string): void {
    const prefix = configKey.split(".")[0];

    for (const node of graph.nodes.values()) {
        if (node.type !== "config_literal" || node.id === configKeyId) {
            continue;
        }

        if (node.id.startsWith("config_key:")) {
            continue;
        }

        const literalFile = (node.file ?? "").replace(/\\/g, "/");
        if (!literalFile.includes(`/config/${prefix}.php`)) {
            continue;
        }

        graph.edges.set(`${configKeyId}->${node.id}`, {
            from: configKeyId,
            to: node.id,
            type: "REFERENCES",
            confidence: 0.85,
            reason: "Config key resolves to file literal",
        });
    }
}

function extractFirstStringArgument(node: Parser.SyntaxNode): string | null {
    const args = node.childForFieldName("arguments");
    if (!args) {
        return null;
    }

    for (const child of args.namedChildren) {
        if (child.type === "string" || child.type === "encapsed_string") {
            const value = cleanPhpString(child.text);
            if (value) {
                return value;
            }
        }
    }

    return null;
}
