import Parser from "tree-sitter";
import {classType} from "../astHandlers/node_types/class";
import {methodType} from "../astHandlers/node_types/method";
import {memberCallExpressionType} from "../astHandlers/node_types/memberCallExpression";
import {WalkContext} from "./context";
import {assignmentExpression} from "../astHandlers/node_types/assignmentExpression";
import {nameSpaceDefinitionType} from "../astHandlers/node_types/nameSpaceDefinitionType";
import {useDeclarationType} from "../astHandlers/node_types/useDeclarationType";
import {resolveParameters} from "../resolvers/resolveParameters";
import {scopedCallExpressionType} from "../astHandlers/node_types/scopedCallExpression";
import {interfaceDeclaration} from "../astHandlers/node_types/interfaceDeclaration";
import {resolveImplements} from "../resolvers/resolveImplements";
import {resolveExtends} from "../resolvers/resolveExtends";
import {resolveTraits} from "../resolvers/resolveTraits";
import {arrayElementInitializerType} from "../astHandlers/node_types/arrayElementInitializer";
import {requestInputType} from "../astHandlers/node_types/requestInput";
import {subscriptExpressionType} from "../astHandlers/node_types/subscriptExpression";
import {validationExpressionType} from "../astHandlers/node_types/validationExpression";
import {dataFlowAssignment} from "../astHandlers/node_types/DataFlowAssignment";
import {dataFlowMethodCall} from "../astHandlers/node_types/dataFlowMethodCall";
import {propertyDeclarationType} from "../astHandlers/node_types/propertyDeclaration";
import {returnStatementType} from "../astHandlers/node_types/returnStatement";
import {extractFormRequestRules} from "../astHandlers/node_types/formRequestRules";
import {persistArrayElementType} from "../astHandlers/node_types/persistArrayElement";
import {
    resolvePersistTargetFromMemberCall,
    resolvePersistTargetFromScopedCall,
} from "../semantic/persistTarget";
import {configLiteralType} from "../astHandlers/node_types/configLiteral";
import {functionCallExpressionType} from "../astHandlers/node_types/functionCallExpression";
import {classPropertyTypesForClass} from "./classPropertyTypesRegistry";
import {traitType} from "../astHandlers/node_types/trait";
import {foreachStatementType} from "../astHandlers/node_types/foreachStatement";
import {objectCreationExpressionType} from "../astHandlers/node_types/objectCreationExpression";
import {applyClassPhpDocProperties} from "../semantic/phpDocPropertyTypes";

export default function walk(rootNode: Parser.SyntaxNode, file:string, context: WalkContext):void {
    for(const child of rootNode.children) {
        let childContext = context;
        switch (child.type) {
            case 'namespace_definition':
                context.currentNamespace = nameSpaceDefinitionType(child);
                childContext = context;
                break;
            case 'namespace_use_clause':
                const useImport = useDeclarationType(child);
                context.imports.set(useImport.alias, useImport.fullName);
                childContext = context;
                break;
            case 'class_declaration': {
                const currentClass = classType(child, file, context);
                childContext = {
                    ...context,
                    currentClass,
                    currentInterface: undefined,
                    classPropertyTypes: classPropertyTypesForClass(child, context, currentClass),
                };
                resolveExtends(child, childContext);
                resolveTraits(child, childContext);
                resolveImplements(child, childContext);
                applyClassPhpDocProperties(child, childContext);
                break;
            }
            case "trait_declaration": {
                const currentTrait = traitType(child, file, context);
                childContext = {
                    ...context,
                    currentClass: currentTrait,
                    currentInterface: undefined,
                    classPropertyTypes: new Map<string, string>(),
                };
                break;
            }
            case "interface_declaration" :
                childContext = {
                    ...context,
                    currentInterface: interfaceDeclaration(child, file,context),
                    currentClass: undefined,
                    classPropertyTypes: new Map<string, string>(),
                }
                break;
            case 'method_declaration':
                const methodContext = {
                    ...context,
                    variableTypes: new Map<string, string>(context.classPropertyTypes),
                    dataFlows: new Map<string, Set<string>>(),
                };

                const currentMethod = methodType(child, file, methodContext);

                childContext = {
                    ...methodContext,
                    currentMethod,
                };

                resolveParameters(child, childContext);
                break;
            case 'assignment_expression':
                assignmentExpression(child, childContext, file);
                dataFlowAssignment(child, childContext);
                break;
            case "scoped_call_expression":
                scopedCallExpressionType(child, childContext);
                {
                    const persistTarget = resolvePersistTargetFromScopedCall(child, childContext);
                    if (persistTarget) {
                        childContext = { ...childContext, persistTargetClass: persistTarget };
                    }
                }
                break;

            case "function_call_expression":
                functionCallExpressionType(child, childContext);
                break;

            case "object_creation_expression":
                objectCreationExpressionType(child, childContext);
                break;

            case "array_element_initializer":
                arrayElementInitializerType(child, childContext);
                persistArrayElementType(child, childContext, file);
                break;

            case "member_call_expression":
                memberCallExpressionType(child, childContext);
                requestInputType(child, childContext);
                validationExpressionType(child, childContext);
                dataFlowMethodCall(child, childContext);
                {
                    const persistTarget = resolvePersistTargetFromMemberCall(child, childContext);
                    if (persistTarget) {
                        childContext = { ...childContext, persistTargetClass: persistTarget };
                    }
                }
                break;

            case "subscript_expression":
                subscriptExpressionType(child, childContext);
                break;

            case "property_declaration":
                propertyDeclarationType(child, childContext, file);
                break;

            case "return_statement":
                extractFormRequestRules(child, childContext);
                returnStatementType(child, childContext, file);
                break;

            case "foreach_statement":
                childContext = foreachStatementType(child, childContext);
                break;

            case "string":
            case "encapsed_string":
                configLiteralType(child, childContext, file);
                break;

        }
         walk(child, file, childContext);
    }
};
