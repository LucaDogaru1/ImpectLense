import Parser from "tree-sitter";
import { graph } from "../../../../graph/graph";
import { WalkContext } from "../../walk/context";
import { ensureSqsConsumerRole } from "../../semantic/classRoles";

const SQS_CLIENT_METHODS = new Set([
    "receivemessage",
    "deletemessage",
    "getqueueurl",
    "sendmessage",
]);

export function sqsMethodCallType(
    rootNode: Parser.SyntaxNode,
    context: WalkContext
): void {
    if (!context.currentClass) {
        return;
    }

    const calledName = rootNode.childForFieldName("name")?.text;
    if (!calledName || !SQS_CLIENT_METHODS.has(calledName.toLowerCase())) {
        return;
    }

    const classNode = graph.nodes.get(context.currentClass);
    const file = classNode?.file ?? "";

    ensureSqsConsumerRole(context.currentClass, file);
}
