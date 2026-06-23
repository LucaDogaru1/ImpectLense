import Parser from "tree-sitter";
import { WalkContext } from "../../walk/context";
import { cleanPhpString, ensureModelField, ensureResponseField, isLikelyFieldName, linkSerializes } from "../../semantic/fieldNodes";
import {
    collectModelFieldPathsForProperty,
    extractNestedArrayFieldEntries,
    extractPropertyAccessPath,
    extractThisPropertyName,
    NestedFieldEntry,
} from "../../semantic/nestedArrayFields";
import { graph } from "../../../../graph/graph";

export function returnStatementType(
    node: Parser.SyntaxNode,
    context: WalkContext,
    file: string
): void {
    if (!context.currentMethod || !context.currentClass) return;

    if (!isApiOutputContext(context.currentMethod, context.currentClass, file)) {
        return;
    }

    const arrayNodes = collectRootReturnArrays(node);
    if (arrayNodes.length === 0) return;

    const emitted = new Set<string>();

    for (const arrayNode of arrayNodes) {
        for (const entry of extractResponseFieldEntries(arrayNode, context.currentClass)) {
            emitResponseFieldEntry(
                context.currentClass,
                context.currentMethod,
                entry,
                file,
                emitted
            );
        }
    }
}

function emitResponseFieldEntry(
    className: string,
    methodId: string,
    entry: NestedFieldEntry,
    file: string,
    emitted: Set<string>
): void {
    if (emitted.has(entry.path)) {
        return;
    }

    emitted.add(entry.path);

    const responseFieldNodeId = ensureResponseField(className, entry.path, file);
    linkSerializes(methodId, responseFieldNodeId);

    if (entry.modelProperty) {
        const modelFieldNodeId = ensureModelField(className, entry.modelProperty, file);

        graph.edges.set(`${responseFieldNodeId}->${modelFieldNodeId}`, {
            from: responseFieldNodeId,
            to: modelFieldNodeId,
            type: "REFERENCES",
            confidence: 0.9,
            reason: "API response key maps to model property",
        });
    }
}

function isNestedArrayValue(valueNode: Parser.SyntaxNode | null | undefined): valueNode is Parser.SyntaxNode {
    if (!valueNode) {
        return false;
    }

    return (
        valueNode.type === "array_creation_expression" ||
        valueNode.type === "short_array_creation_expression"
    );
}

function extractResponseFieldEntries(
    arrayNode: Parser.SyntaxNode,
    className: string
): NestedFieldEntry[] {
    const entries: NestedFieldEntry[] = [];

    for (const child of arrayNode.namedChildren) {
        if (child.type !== "array_element_initializer") {
            continue;
        }

        const keyNode = child.namedChildren[0];
        if (!keyNode) {
            continue;
        }

        const key = cleanPhpString(keyNode.text);
        if (!isLikelyFieldName(key)) {
            continue;
        }

        const valueNode = child.namedChildren[child.namedChildren.length - 1];
        const valueText = valueNode?.text ?? "";

        if (isNestedArrayValue(valueNode)) {
            entries.push({ path: key, modelProperty: null });
            entries.push(...extractNestedArrayFieldEntries(valueNode, key));
            continue;
        }

        const passthroughProperty = extractThisPropertyName(valueText);
        if (passthroughProperty && !valueText.includes("[")) {
            entries.push({ path: passthroughProperty, modelProperty: passthroughProperty });

            for (const path of collectModelFieldPathsForProperty(
                className,
                passthroughProperty,
                graph.nodes.values()
            )) {
                if (path === passthroughProperty) {
                    continue;
                }

                entries.push({
                    path,
                    modelProperty: path,
                });
            }
            continue;
        }

        entries.push({
            path: key,
            modelProperty: extractPropertyAccessPath(valueText) ?? extractThisPropertyName(valueText),
        });
    }

    return entries;
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

function collectRootReturnArrays(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
    const arrays: Parser.SyntaxNode[] = [];

    function walk(current: Parser.SyntaxNode, insideArray: boolean): void {
        const isArray =
            current.type === "array_creation_expression" ||
            current.type === "short_array_creation_expression";

        if (isArray && !insideArray) {
            arrays.push(current);
        }

        for (const child of current.namedChildren) {
            walk(child, insideArray || isArray);
        }
    }

    for (const child of node.namedChildren) {
        walk(child, false);
    }

    return arrays;
}
