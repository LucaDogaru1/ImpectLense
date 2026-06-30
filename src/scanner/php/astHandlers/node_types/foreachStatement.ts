import Parser from "tree-sitter";
import { WalkContext } from "../../walk/context";
import { resolveCollectionElementType } from "../../semantic/phpDocPropertyTypes";

function findForeachParts(node: Parser.SyntaxNode): {
    collectionNode?: Parser.SyntaxNode;
    valueVariable?: Parser.SyntaxNode;
} {
    const loopParts = node.namedChildren.filter(child => child.type !== "compound_statement");
    const collectionNode = loopParts[0];
    const valuePart = loopParts[1];

    if (!collectionNode || !valuePart) {
        return {};
    }

    if (valuePart.type === "pair") {
        const valueVariable = valuePart.namedChildren.find(
            namedChild =>
                namedChild.type === "variable_name" &&
                namedChild !== valuePart.namedChildren[0]
        );

        return { collectionNode, valueVariable };
    }

    if (valuePart.type === "variable_name") {
        return { collectionNode, valueVariable: valuePart };
    }

    return { collectionNode };
}

export function foreachStatementType(
    node: Parser.SyntaxNode,
    context: WalkContext
): WalkContext {
    const { collectionNode, valueVariable } = findForeachParts(node);

    if (!collectionNode || !valueVariable) {
        return context;
    }

    const elementType = resolveCollectionElementType(collectionNode, context);

    if (!elementType) {
        return context;
    }

    const variableTypes = new Map(context.variableTypes);
    variableTypes.set(valueVariable.text, elementType);
    variableTypes.set(valueVariable.text.replace(/^\$/, ""), elementType);

    return {
        ...context,
        variableTypes,
    };
}
