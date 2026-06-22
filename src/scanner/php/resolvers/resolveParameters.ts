import Parser from "tree-sitter";
import { WalkContext } from "../walk/context";
import { resolveClassName } from "./resolveClassName";
import { graph } from "../../../graph/graph";

const BUILTIN_TYPES = new Set([
    "string",
    "int",
    "float",
    "bool",
    "array",
    "callable",
    "iterable",
    "mixed",
    "object",
    "void",
    "null",
    "false",
    "true",
    "self",
    "static",
    "parent",
]);

function isBuiltinType(type: string): boolean {
    return BUILTIN_TYPES.has(type.toLowerCase());
}

export function resolveParameters(
    rootNodeChild: Parser.SyntaxNode,
    context: WalkContext
): void {
    const isConstructor =
        context.currentMethod?.endsWith("::__construct");

    const formalParameters = rootNodeChild.children.find(
        child => child.type === "formal_parameters"
    );

    if (!formalParameters || !context.currentMethod) {
        return;
    }

    let argumentIndex = 0;

    for (const param of formalParameters.children) {
        if (
            param.type !== "simple_parameter" &&
            param.type !== "property_promotion_parameter"
        ) {
            continue;
        }

        let namedType = "";

        const parameterName =
            param.childForFieldName("name")?.text ??
            param.children.find(
                paramChild => paramChild.type === "variable_name"
            )?.text ??
            "";

        for (const paramChild of param.children) {
            if (paramChild.type === "named_type") {
                namedType = paramChild.text;
            }
        }

        if (!parameterName) {
            continue;
        }

        const cleanParameterName = parameterName.replace("$", "");
        const parameterId =
            `${context.currentMethod}::${parameterName}`;

        const resolvedName = namedType
            ? resolveClassName(namedType, context)
            : "mixed";

        graph.nodes.set(parameterId, {
            id: parameterId,
            parent: context.currentMethod,
            type: "parameter",
            name: parameterName,
            scope: context.currentMethod,
            dataType: resolvedName,
        });

        graph.edges.set(
            `${context.currentMethod}->${parameterId}:HAS_PARAMETER`,
            {
                from: context.currentMethod,
                to: parameterId,
                type: "HAS_PARAMETER",
                argumentIndex,
            }
        );

        if (namedType) {
            context.variableTypes.set(parameterName, resolvedName);
            context.variableTypes.set(cleanParameterName, resolvedName);
        }

        if (
            namedType &&
            isConstructor &&
            context.currentClass &&
            !isBuiltinType(resolvedName)
        ) {
            graph.edges.set(
                `${context.currentClass}->${resolvedName}:DEPENDS_ON`,
                {
                    from: context.currentClass,
                    to: resolvedName,
                    type: "DEPENDS_ON",
                }
            );
        }

        if (namedType && isConstructor) {
            const propertyAsPhp = `$this->${cleanParameterName}`;
            const propertyAsDot = `this.${cleanParameterName}`;

            context.variableTypes.set(propertyAsPhp, resolvedName);
            context.variableTypes.set(propertyAsDot, resolvedName);
            context.classPropertyTypes.set(propertyAsPhp, resolvedName);
            context.classPropertyTypes.set(propertyAsDot, resolvedName);
        }

        argumentIndex++;
    }
}