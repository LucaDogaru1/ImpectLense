import Parser from "tree-sitter";
import { graph } from "../../../graph/graph";
import { JsWalkContext } from "../walk/context";
import { resolveImportSource, toJsModuleId } from "../resolvers/resolveImportPath";

function readImportSource(node: Parser.SyntaxNode): string | null {
    const stringNode = node.children.find(child => child.type === "string");
    const fragment = stringNode?.children.find(child => child.type === "string_fragment");
    return fragment?.text ?? null;
}

function readDefaultImport(node: Parser.SyntaxNode): string | null {
    const clause = node.children.find(child => child.type === "import_clause");
    const identifier = clause?.children.find(child => child.type === "identifier");
    return identifier?.text ?? null;
}

function readNamedImports(node: Parser.SyntaxNode): string[] {
    const clause = node.children.find(child => child.type === "import_clause");
    const named = clause?.children.find(child => child.type === "named_imports");
    if (!named) {
        return [];
    }

    return named.children
        .filter(child => child.type === "import_specifier")
        .map(child => child.childForFieldName("name")?.text ?? child.text.replace(/[,{}]/g, "").trim())
        .filter(Boolean);
}

export function importStatementType(node: Parser.SyntaxNode, context: JsWalkContext): void {
    const source = readImportSource(node);
    if (!source) {
        return;
    }

    const resolved = resolveImportSource(context.file, source);
    const targetModuleId = toJsModuleId(resolved);

    if (!graph.nodes.has(targetModuleId)) {
        graph.nodes.set(targetModuleId, {
            id: targetModuleId,
            type: "js_module",
            name: resolved,
            file: resolved,
            description: "Imported JavaScript module (stub until scanned)",
        });
    }

    graph.edges.set(`${context.moduleId}->${targetModuleId}:IMPORTS`, {
        from: context.moduleId,
        to: targetModuleId,
        type: "IMPORTS",
        via: source,
    });

    const defaultImport = readDefaultImport(node);
    if (defaultImport) {
        context.imports.set(defaultImport, targetModuleId);
    }

    for (const namedImport of readNamedImports(node)) {
        context.imports.set(namedImport, targetModuleId);
    }
}
