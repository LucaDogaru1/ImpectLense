import Parser from "tree-sitter";
import { callExpressionType } from "../astHandlers/callExpression";
import { classDeclarationType } from "../astHandlers/classDeclaration";
import { exportStatementType } from "../astHandlers/exportStatement";
import { functionDeclarationType } from "../astHandlers/functionDeclaration";
import {
    trackHttpResourceDeclarator,
    trackHttpResourcesInObject,
} from "../astHandlers/httpResourceExport";
import { importStatementType } from "../astHandlers/importStatement";
import { ensureJsModuleNode } from "../astHandlers/jsModule";
import { trackModuleConstants } from "../astHandlers/moduleConstants";
import { JsWalkContext } from "./context";

export default function walk(
    rootNode: Parser.SyntaxNode,
    file: string,
    context: JsWalkContext
): void {
    for (const child of rootNode.children) {
        let childContext = context;

        switch (child.type) {
            case "import_statement":
                importStatementType(child, childContext);
                break;
            case "export_statement":
                childContext = exportStatementType(child, childContext);
                break;
            case "lexical_declaration":
                trackModuleConstants(child, childContext);
                for (const declarator of child.children) {
                    if (declarator.type === "variable_declarator") {
                        trackHttpResourceDeclarator(declarator, childContext);
                    }
                }
                break;
            case "function_declaration": {
                const functionId = functionDeclarationType(child, childContext);
                childContext = { ...childContext, currentFunction: functionId || childContext.currentFunction };
                break;
            }
            case "class_declaration": {
                const classId = classDeclarationType(child, childContext);
                childContext = { ...childContext, currentComponent: classId || childContext.currentComponent };
                break;
            }
            case "call_expression":
                callExpressionType(child, childContext);
                break;
        }

        walk(child, file, childContext);
    }
}

export function createWalkContext(file: string): JsWalkContext {
    const moduleId = ensureJsModuleNode(file);
    return {
        moduleId,
        file,
        imports: new Map(),
        moduleConstants: new Map(),
    };
}
