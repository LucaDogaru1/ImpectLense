export type OutputMode = "json" | "sqlite" | "both";
export type ScanLanguage = "php" | "js" | "both";

export interface ScanCliOptions {
    rootDir: string;
    outputMode: OutputMode;
    sqlitePath: string;
    language: ScanLanguage;
    mergeExistingGraph: boolean;
    graphJsonPath: string;
}
