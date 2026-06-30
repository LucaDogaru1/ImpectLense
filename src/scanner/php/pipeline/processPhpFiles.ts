import {parsePhpFile} from "../parse/fileParser";
import walk from "../walk/phpWalker";
import {ScannedPhpFile} from "../scanPhp";
import Parser from "tree-sitter";
import {WalkContext} from "../walk/context";
import {resolveInterfaceCalls} from "../resolvers/resolveInterfaceCalls";
import {resolveExtendsCalls} from "../resolvers/resolveExtendsCalls";
import {resolveOverrideCalls} from "../resolvers/resolveOverrideCalls";
import {pruneExternalExtendsEdges} from "../resolvers/pruneExternalExtends";
import {resolveBladeMethodCalls} from "../resolvers/resolveBladeMethodCalls";
import {resolveArgumentEdges} from "../resolvers/resolveArgumentEdges";
import {
    extractRoutesFromRouteFile,
    isRouteFile,
} from "../routes/routeFileExtractor";
import {
    classPropertyTypesRegistry,
    propagateClassPropertyTypes,
} from "../walk/classPropertyTypesRegistry";
import { isBladeFile } from "../blade/bladeScanner";
import { parseBladeFile } from "../blade/parseBladeFile";
import { errorDetail, recordScanFailure } from "../../../shared/reporting/scanFailures";
import { createScanProgress } from "../../../shared/reporting/scanProgress";

function walkPhpFile(parser: Parser, file: ScannedPhpFile): boolean {
    try {
        const tree = parsePhpFile(parser, file.absolutePath);

        if (tree.rootNode.hasError) {
            recordScanFailure({
                file: file.relativePath,
                reason: "php_parse_error",
                detail: "tree-sitter hasError",
            });
            return false;
        }

        const context: WalkContext = {
            classPropertyTypes: new Map(),
            variableTypes: new Map(),
            imports: new Map(),
            extractedFields: [],
            dataFlows: new Map(),
        };

        walk(tree.rootNode, file.relativePath, context);
        return true;
    } catch (error) {
        recordScanFailure({
            file: file.relativePath,
            reason: "php_parser_crash",
            detail: errorDetail(error),
        });
        return false;
    }
}

export function processPhpFiles(files: ScannedPhpFile[], parser: Parser) {
    let extractedRouteCount = 0;
    let bladeFileCount = 0;
    const phpFiles: ScannedPhpFile[] = [];

    classPropertyTypesRegistry.clear();

    const prepProgress = createScanProgress({ label: "PHP prep", total: files.length });
    prepProgress.start();

    for (const file of files) {
        if (isBladeFile(file.relativePath)) {
            try {
                parseBladeFile(file.absolutePath, file.relativePath);
                bladeFileCount += 1;
            } catch (error) {
                recordScanFailure({
                    file: file.relativePath,
                    reason: "blade_scan_failed",
                    detail: errorDetail(error),
                });
            }
            prepProgress.tick(file.relativePath);
            continue;
        }

        if (isRouteFile(file.relativePath)) {
            try {
                extractedRouteCount += extractRoutesFromRouteFile(
                    file.absolutePath,
                    file.relativePath
                );
            } catch (error) {
                recordScanFailure({
                    file: file.relativePath,
                    reason: "route_extraction_failed",
                    detail: errorDetail(error),
                });
            }
            prepProgress.tick(file.relativePath);
            continue;
        }

        phpFiles.push(file);
        prepProgress.tick(file.relativePath);
    }

    prepProgress.done();

    const walkablePhpFiles: ScannedPhpFile[] = [];
    const walkProgress = createScanProgress({ label: "PHP walk", total: phpFiles.length });
    walkProgress.start();

    for (const file of phpFiles) {
        if (walkPhpFile(parser, file)) {
            walkablePhpFiles.push(file);
        }
        walkProgress.tick(file.relativePath);
    }

    walkProgress.done();

    const propagateProgress = createScanProgress({ label: "PHP types" });
    propagateProgress.start();
    propagateClassPropertyTypes();
    propagateProgress.done();

    const walk2Progress = createScanProgress({
        label: "PHP walk (2)",
        total: walkablePhpFiles.length,
    });
    walk2Progress.start();

    for (const file of walkablePhpFiles) {
        walkPhpFile(parser, file);
        walk2Progress.tick(file.relativePath);
    }

    walk2Progress.done();

    const resolveProgress = createScanProgress({ label: "PHP resolve" });
    resolveProgress.start();
    resolveInterfaceCalls();
    pruneExternalExtendsEdges();
    resolveExtendsCalls();
    resolveOverrideCalls();
    resolveBladeMethodCalls();
    resolveArgumentEdges();
    resolveProgress.done();

    if (extractedRouteCount > 0) {
        console.log(`Extracted ${extractedRouteCount} Laravel routes from route files`);
    }

    if (bladeFileCount > 0) {
        console.log(`Scanned ${bladeFileCount} Blade views`);
    }
}
