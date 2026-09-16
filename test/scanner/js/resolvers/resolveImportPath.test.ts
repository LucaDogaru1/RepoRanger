import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadScanConfig } from "../../../../src/shared/config/scanRuntime";
import { resolveImportSource } from "../../../../src/scanner/js/resolvers/resolveImportPath";

function write(root: string, relativePath: string, contents: string = ""): void {
    const absolutePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, contents);
}

function withFixture(run: (root: string) => void): void {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "repo-ranger-aliases-"));
    try {
        run(root);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function testScopedTsconfigAliases(): void {
    withFixture(root => {
        write(root, "apps/cms/tsconfig.json", `{
            // JSONC comments and trailing commas are supported.
            "compilerOptions": {
                "baseUrl": ".",
                "paths": { "@/*": ["src/*"], },
            },
        }`);
        write(root, "apps/cms/src/components/Callout.vue", "<template />");
        write(root, "apps/cms/src/pages/Home.vue", "<template />");

        write(root, "apps/site/tsconfig.json", JSON.stringify({
            compilerOptions: {
                paths: { "@/*": ["client/*"] },
            },
        }));
        write(root, "apps/site/client/components/Callout.ts", "export default {};");
        write(root, "apps/site/client/pages/Home.ts", "export {};");

        const config = loadScanConfig(root);
        assert.equal(config.pathAliasScopes?.length, 2);
        assert.equal(
            resolveImportSource("apps/cms/src/pages/Home.vue", "@/components/Callout"),
            "apps/cms/src/components/Callout.vue"
        );
        assert.equal(
            resolveImportSource("apps/site/client/pages/Home.ts", "@/components/Callout"),
            "apps/site/client/components/Callout.ts"
        );
    });
}

function testNuxtDefaultsAndDirectoryIndexes(): void {
    withFixture(root => {
        write(root, "apps/site/nuxt.config.ts", `export default defineNuxtConfig({
            srcDir: 'app',
        });`);
        write(root, "apps/site/app/pages/index.vue", "<template />");
        write(root, "apps/site/app/components/Callout/index.vue", "<template />");

        loadScanConfig(root);
        assert.equal(
            resolveImportSource("apps/site/app/pages/index.vue", "~/components/Callout"),
            "apps/site/app/components/Callout/index.vue"
        );
    });
}

function testStaticViteAliases(): void {
    withFixture(root => {
        write(root, "apps/site/vite.config.ts", `
            import { fileURLToPath, URL } from 'node:url';
            export default defineConfig({
                resolve: {
                    alias: {
                        '@': fileURLToPath(new URL('./frontend', import.meta.url)),
                    },
                },
            });
        `);
        write(root, "apps/site/frontend/main.ts", "export {};");
        write(root, "apps/site/frontend/ui/Button.vue", "<template />");

        loadScanConfig(root);
        assert.equal(
            resolveImportSource("apps/site/frontend/main.ts", "@/ui/Button"),
            "apps/site/frontend/ui/Button.vue"
        );
    });
}

function testViteUrlRootAlias(): void {
    withFixture(root => {
        write(root, "apps/cms/vite.config.ts", `export default defineConfig({
            resolve: {
                alias: {
                    '@': '/resources/assets/js',
                },
            },
        });`);
        write(root, "apps/cms/resources/assets/js/main.ts", "export {};");
        write(root, "apps/cms/resources/assets/js/components/Callout.vue", "<template />");

        loadScanConfig(root);
        assert.equal(
            resolveImportSource("apps/cms/resources/assets/js/main.ts", "@/components/Callout"),
            "apps/cms/resources/assets/js/components/Callout.vue"
        );
    });
}

function testExplicitConfigOverridesDiscovery(): void {
    withFixture(root => {
        write(root, "repo-ranger.config.json", JSON.stringify({
            pathAliases: { "@/": "manual/" },
        }));
        write(root, "apps/site/tsconfig.json", JSON.stringify({
            compilerOptions: { paths: { "@/*": ["src/*"] } },
        }));
        write(root, "apps/site/src/Callout.vue", "<template />");
        write(root, "manual/Callout.ts", "export {};");

        loadScanConfig(root);
        assert.equal(
            resolveImportSource("apps/site/src/Page.vue", "@/Callout"),
            "manual/Callout.ts"
        );
    });
}

function testMultiRootGraphPrefix(): void {
    withFixture(root => {
        write(root, "tsconfig.json", JSON.stringify({
            compilerOptions: { paths: { "@/*": ["src/*"] } },
        }));
        write(root, "src/main.ts", "export {};");
        write(root, "src/useFeature.ts", "export {};");

        loadScanConfig(root, "frontend/");
        assert.equal(
            resolveImportSource("frontend/src/main.ts", "@/useFeature"),
            "frontend/src/useFeature.ts"
        );
    });
}

function run(): void {
    console.log("resolveImportPath tests\n");

    testScopedTsconfigAliases();
    console.log("  ✓ resolves the same alias independently per monorepo app");

    testNuxtDefaultsAndDirectoryIndexes();
    console.log("  ✓ discovers Nuxt defaults and index.vue modules");

    testStaticViteAliases();
    console.log("  ✓ extracts static Vite aliases without executing config code");

    testViteUrlRootAlias();
    console.log("  ✓ resolves Vite URL-root aliases relative to their app config");

    testExplicitConfigOverridesDiscovery();
    console.log("  ✓ keeps repo-ranger.config.json as the highest-priority override");

    testMultiRootGraphPrefix();
    console.log("  ✓ preserves multi-root graph path prefixes");

    console.log("\nAll resolveImportPath tests passed.");
}

run();
