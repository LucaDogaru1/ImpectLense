import { createPhpParser } from "../scanner/php/parse/parser";
import { processPhpFiles } from "../scanner/php/pipeline/processPhpFiles";
import { scanPhpFiles } from "../scanner/php/scanPhp";
import { createJsParser } from "../scanner/js/parse/parser";
import { processJsFiles } from "../scanner/js/pipeline/processJsFiles";
import { scanJsFiles } from "../scanner/js/scanJs";
import writeGraphJson from "../persistence/writeGraphJson";
import writeGraphSqlite from "../persistence/writeGraphSqlite";
import chalk from "chalk";
import { loadScanConfig } from "../shared/config/scanRuntime";
import { DEFAULT_SCAN_IGNORE, parseScanCliOptions } from "../shared/utils/scanCli";
import { loadGraphJson, mergeGraphs } from "../persistence/loadGraphJson";
import { graph, resetGraph } from "../graph/graph";

const {
    rootDir,
    outputMode,
    sqlitePath,
    language,
    mergeExistingGraph,
    graphJsonPath,
} = parseScanCliOptions(process.argv.slice(2));

console.log("rootDir:", rootDir);
console.log("language:", language);
const scanConfig = loadScanConfig(rootDir);
if (scanConfig.pathAliases && Object.keys(scanConfig.pathAliases).length > 0) {
    console.log("scan config: path aliases loaded");
}
console.log(chalk.blue.bold("🔍 Starting directory scan...\n"));

resetGraph();

if (language === "php" || language === "both") {
    const phpParser = createPhpParser();
    const phpFiles = scanPhpFiles(rootDir, DEFAULT_SCAN_IGNORE);
    console.log(chalk.cyan(`PHP files: ${phpFiles.length}`));
    processPhpFiles(phpFiles, phpParser);
    console.log(chalk.green("✅ finished PHP walk"));
}

if (language === "js" || language === "both") {
    const jsParser = createJsParser();
    const jsFiles = scanJsFiles(rootDir, DEFAULT_SCAN_IGNORE);
    console.log(chalk.cyan(`JS files: ${jsFiles.length}`));
    processJsFiles(jsFiles, jsParser);
    console.log(chalk.green("✅ finished JS walk"));
}

if (mergeExistingGraph) {
    const loadedGraph = loadGraphJson(graphJsonPath);
    mergeGraphs(graph, loadedGraph);
}

console.log(chalk.blue(`Graph size: ${graph.nodes.size} nodes, ${graph.edges.size} edges`));

if (outputMode === "json" || outputMode === "both") {
    writeGraphJson(graphJsonPath);
    console.log(chalk.green(`Wrote ${graphJsonPath}`));
}

if (outputMode === "sqlite" || outputMode === "both") {
    writeGraphSqlite(sqlitePath);
    console.log(chalk.green(`Wrote ${sqlitePath}`));
}
