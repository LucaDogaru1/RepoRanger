export type FileRole = "source" | "test" | "migration" | "fixture";

const TEST_DIRECTORY_SEGMENTS = new Set([
    "test",
    "tests",
    "__tests__",
    "__test__",
    "spec",
    "specs",
    "e2e",
    "cypress",
    "playwright",
    "k6",
    "testing",
]);

const FIXTURE_DIRECTORY_SEGMENTS = new Set([
    "fixtures",
    "fixture",
    "factories",
    "seeders",
    "seeds",
    "stubs",
    "mocks",
    "__mocks__",
]);

const MIGRATION_DIRECTORY_SEGMENTS = new Set([
    "migrations",
    "migration",
]);

const TEST_FILE_NAME = /(?:^|[.\-_])(?:test|tests|spec|specs)\.[cm]?[jt]sx?$|(?:Test|TestCase|Cest|Spec)\.php$/;
const MIGRATION_FILE_NAME = /^\d{4}_\d{2}_\d{2}_\d{6}_.+\.php$|^\d{4}-\d{2}-\d{2}.*\.(?:php|sql)$|\.sql$/;

function pathSegments(file: string): string[] {
    return file.replace(/\\/g, "/").split("/").filter(Boolean);
}

export function classifyFileRole(file: string | null | undefined): FileRole {
    if (!file) {
        return "source";
    }

    const segments = pathSegments(file);
    const fileName = segments[segments.length - 1] ?? "";
    const directories = segments.slice(0, -1).map(segment => segment.toLowerCase());

    if (directories.some(segment => TEST_DIRECTORY_SEGMENTS.has(segment)) || TEST_FILE_NAME.test(fileName)) {
        return "test";
    }

    if (directories.some(segment => MIGRATION_DIRECTORY_SEGMENTS.has(segment)) || MIGRATION_FILE_NAME.test(fileName)) {
        return "migration";
    }

    if (directories.some(segment => FIXTURE_DIRECTORY_SEGMENTS.has(segment))) {
        return "fixture";
    }

    return "source";
}

export function isTestFile(file: string | null | undefined): boolean {
    return classifyFileRole(file) === "test";
}

export function isProductionSourceFile(file: string | null | undefined): boolean {
    return classifyFileRole(file) === "source";
}

export function fileRolePenalty(file: string | null | undefined): number {
    switch (classifyFileRole(file)) {
        case "test":
            return 900;
        case "fixture":
            return 700;
        case "migration":
            return 450;
        default:
            return 0;
    }
}
