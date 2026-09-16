import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    classifyCodeLocation,
    discoverProjectScopes,
} from "../../../src/shared/classification/codeLocation";

function write(root: string, relativePath: string, contents: string): void {
    const absolutePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, contents);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "repo-ranger-scopes-"));
try {
    write(root, "apps/legacy/package.json", JSON.stringify({
        name: "legacy-app",
        devDependencies: { "@vitejs/plugin-vue2": "^2.3.0", vue: "^2.7.0" },
    }));
    write(root, "apps/nuxt/package.json", JSON.stringify({
        name: "nuxt-app",
        dependencies: { nuxt: "^3.20.0" },
    }));
    write(root, "apps/nuxt/nuxt.config.ts", "export default defineNuxtConfig({});");
    write(root, "packages/common/package.json", JSON.stringify({ name: "common" }));

    const scopes = discoverProjectScopes(root);
    assert.equal(
        classifyCodeLocation("apps/legacy/src/App.vue", scopes).runtime,
        "legacy-vue"
    );
    assert.equal(
        classifyCodeLocation("apps/nuxt/pages/index.vue", scopes).runtime,
        "nuxt"
    );
    assert.equal(
        classifyCodeLocation("packages/common/src/index.ts", scopes).runtime,
        "shared"
    );

    const legacyAsset = classifyCodeLocation(
        "apps/nuxt/resources/assets/js/OldWidget.vue",
        scopes
    );
    assert.equal(legacyAsset.runtime, "legacy-vue", "legacy asset path overrides package runtime");
    assert.equal(legacyAsset.workspace, "apps/nuxt");
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}

console.log("code location classification tests passed");
