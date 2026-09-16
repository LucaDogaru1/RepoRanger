import { ScanConfig, loadScanConfig as readScanConfig } from "./scanConfig";

let activeConfig: ScanConfig = {
    httpResourceClassPattern: "Resource",
    scanRoot: process.cwd(),
};

export function setScanConfig(config: ScanConfig): void {
    activeConfig = config;
}

export function getScanConfig(): ScanConfig {
    return activeConfig;
}

export function loadScanConfig(rootDir: string, graphPathPrefix: string = ""): ScanConfig {
    const config = readScanConfig(rootDir, graphPathPrefix);
    setScanConfig(config);
    return config;
}
