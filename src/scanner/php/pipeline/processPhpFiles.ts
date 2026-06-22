import {parsePhpFile} from "../parse/fileParser";
import walk from "../walk/phpWalker";
import {ScannedPhpFile} from "../scanPhp";
import Parser from "tree-sitter";
import {WalkContext} from "../walk/context";
import {resolveInterfaceCalls} from "../resolvers/resolveInterfaceCalls";
import {resolveArgumentEdges} from "../resolvers/resolveArgumentEdges";
import {
    extractRoutesFromRouteFile,
    isRouteFile,
} from "../routes/routeFileExtractor";

export function processPhpFiles(files: ScannedPhpFile[], parser: Parser) {
    let extractedRouteCount = 0;

    for (const file of files) {
        if (isRouteFile(file.relativePath)) {
            try {
                extractedRouteCount += extractRoutesFromRouteFile(
                    file.absolutePath,
                    file.relativePath
                );
            } catch (error) {
                console.error(`Route extraction failed: ${file.absolutePath}`);
                console.error(error);
            }
            continue;
        }

        try {
            const tree = parsePhpFile(parser, file.absolutePath);

            if (tree.rootNode.hasError) {
                console.error(`Error parsing file: ${file.absolutePath}`);
                continue;
            }

            const context: WalkContext = {
                classPropertyTypes: new Map(),
                variableTypes: new Map(),
                imports: new Map(),
                extractedFields: [],
                dataFlows : new Map()
            }
            walk(tree.rootNode, file.relativePath, context);
        } catch (error) {
            console.error(`Parser crashed on file: ${file.absolutePath}`);
            console.error(error);
        }
    }

    if (extractedRouteCount > 0) {
        console.log(`Extracted ${extractedRouteCount} Laravel routes from route files`);
    }

    resolveInterfaceCalls();
    resolveArgumentEdges();
}