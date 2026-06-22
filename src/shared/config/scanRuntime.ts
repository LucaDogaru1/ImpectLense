import { ScanConfig, loadScanConfig as readScanConfig } from "./scanConfig";

let activeConfig: ScanConfig = readScanConfig(process.cwd());

export function setScanConfig(config: ScanConfig): void {
    activeConfig = config;
}

export function getScanConfig(): ScanConfig {
    return activeConfig;
}

export function loadScanConfig(rootDir: string): ScanConfig {
    const config = readScanConfig(rootDir);
    setScanConfig(config);
    return config;
}
