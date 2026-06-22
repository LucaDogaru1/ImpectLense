import Parser from "tree-sitter";
import { WalkContext } from "../../walk/context";
import {
    cleanPhpString,
    ensureModelField,
    ensureResponseField,
    isLikelyFieldName,
    linkSerializes,
} from "../../semantic/fieldNodes";
import { graph } from "../../../../graph/graph";
import { fieldNamesMatch } from "../../../../shared/fieldNameMatching";

export function returnStatementType(
    node: Parser.SyntaxNode,
    context: WalkContext,
    file: string
): void {
    if (!context.currentMethod || !context.currentClass) return;

    if (!isApiOutputContext(context.currentMethod, context.currentClass, file)) {
        return;
    }

    const arrayNodes = collectArrayLiterals(node);
    if (arrayNodes.length === 0) return;

    for (const arrayNode of arrayNodes) {
        for (const entry of extractArrayEntries(arrayNode)) {
            const responseFieldNodeId = ensureResponseField(
                context.currentClass,
                entry.key,
                file
            );
            linkSerializes(context.currentMethod, responseFieldNodeId);

            if (entry.modelProperty) {
                const modelFieldNodeId = ensureModelField(
                    context.currentClass,
                    entry.modelProperty,
                    file
                );

                graph.edges.set(`${responseFieldNodeId}->${modelFieldNodeId}`, {
                    from: responseFieldNodeId,
                    to: modelFieldNodeId,
                    type: "REFERENCES",
                    confidence: 0.9,
                    reason: "API response key maps to model property",
                });
            }
        }
    }
}

function isApiOutputContext(methodId: string, classId: string, file: string): boolean {
    const methodName = methodId.split("::").pop()?.toLowerCase() ?? "";
    const normalizedFile = file.replace(/\\/g, "/").toLowerCase();
    const className = classId.split("\\").pop() ?? classId;

    if (/toarray|tojson|serialize|transform|resource|response/i.test(methodName)) {
        return true;
    }

    if (/\/resources\//i.test(normalizedFile)) {
        return true;
    }

    if (/resource$/i.test(className)) {
        return true;
    }

    return /\/models\//i.test(normalizedFile) && methodName === "toarray";
}

function collectArrayLiterals(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
    const arrays: Parser.SyntaxNode[] = [];

    function walk(current: Parser.SyntaxNode, depth: number): void {
        if (depth > 8) {
            return;
        }

        if (
            current.type === "array_creation_expression" ||
            current.type === "short_array_creation_expression"
        ) {
            arrays.push(current);
        }

        for (const child of current.namedChildren) {
            walk(child, depth + 1);
        }
    }

    for (const child of node.namedChildren) {
        walk(child, 0);
    }

    return arrays;
}

interface ArrayEntry {
    key: string;
    modelProperty: string | null;
}

function extractArrayEntries(arrayNode: Parser.SyntaxNode): ArrayEntry[] {
    const entries: ArrayEntry[] = [];

    for (const child of arrayNode.namedChildren) {
        if (child.type !== "array_element_initializer") continue;

        const keyNode = child.namedChildren[0];
        if (!keyNode) continue;

        const key = cleanPhpString(keyNode.text);
        if (!isLikelyFieldName(key)) continue;

        const valueNode = child.namedChildren[child.namedChildren.length - 1];
        const modelProperty = extractThisProperty(valueNode?.text ?? "");

        entries.push({ key, modelProperty });
    }

    return entries;
}

function extractThisProperty(valueText: string): string | null {
    const match = valueText.match(/\$this->([a-zA-Z_][a-zA-Z0-9_]*)/);
    if (!match?.[1]) {
        return null;
    }

    return match[1];
}
