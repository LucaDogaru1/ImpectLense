import Parser from "tree-sitter";

function isDefineComponentCall(node: Parser.SyntaxNode): boolean {
    if (node.type !== "call_expression") {
        return false;
    }

    const fn = node.childForFieldName("function");
    return fn?.type === "identifier" && fn.text === "defineComponent";
}

export function findVueComponentOptionsObject(root: Parser.SyntaxNode): Parser.SyntaxNode | null {
    for (const child of root.children) {
        if (child.type !== "export_statement") {
            continue;
        }

        for (const exportChild of child.namedChildren) {
            if (exportChild.type === "object") {
                return exportChild;
            }

            if (isDefineComponentCall(exportChild)) {
                const args = exportChild.childForFieldName("arguments");
                const objectArg = args?.namedChildren.find(node => node.type === "object");
                if (objectArg) {
                    return objectArg;
                }
            }
        }
    }

    return null;
}

export function findMethodDefinition(
    objectNode: Parser.SyntaxNode,
    methodName: string
): Parser.SyntaxNode | null {
    for (const child of objectNode.children) {
        if (child.type !== "method_definition") {
            continue;
        }

        const name = child.childForFieldName("name")?.text;
        if (name === methodName) {
            return child;
        }
    }

    return null;
}
