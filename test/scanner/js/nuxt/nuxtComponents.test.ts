import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { graph, resetGraph } from "../../../../src/graph/graph";
import { createJsParser } from "../../../../src/scanner/js/parse/parser";
import { processJsFiles } from "../../../../src/scanner/js/pipeline/processJsFiles";
import { nuxtComponentName, splitByCase } from "../../../../src/scanner/js/nuxt/nuxtComponents";

const vue = (template: string, script = "const title = 'x'") =>
    `<script setup lang="ts">\n${script}\n</script>\n<template>\n${template}\n</template>\n`;

const fixture: Record<string, string> = {
    "apps/shop/nuxt.config.ts": `
import { fileURLToPath } from "node:url"
export default defineNuxtConfig({
  hooks: { "build:before"() {} },
  alias: { "@ui": "../../layers/ui" },
  components: [
    { path: "@ui/components", prefix: "Ui", global: true },
    { path: "~/flat", pathPrefix: false },
    "~/components",
  ],
  extends: ["../../layers/ui", "../../layers/base"],
})`,
    "apps/other/nuxt.config.ts": `export default defineNuxtConfig({ extends: ["../../layers/base"] })`,
    "apps/dynamic/nuxt.config.ts": `export default defineNuxtConfig({ components: dirs, extends: ["../../layers/base"] })`,
    "layers/ui/nuxt.config.ts": `export default defineNuxtConfig({})`,
    "layers/base/nuxt.config.ts": `export default defineNuxtConfig({})`,

    "apps/shop/components/Hero.vue": vue("<div />"),
    "apps/shop/components/user/Card.vue": vue("<div />"),
    "apps/shop/components/base/BaseBtn.vue": vue("<button />"),
    "apps/shop/components/Dup.vue": vue("<div />"),
    "apps/shop/components/dup/index.vue": vue("<div />"),
    "apps/shop/components/Special.vue": vue("<div />"),
    "apps/shop/components/Hidden.vue": vue("<div />"),
    "apps/shop/flat/deep/Plain.vue": vue("<div />"),
    "layers/ui/components/Button.vue": vue("<button />"),
    "layers/base/components/BaseCard.vue": vue("<div />"),
    "apps/other/components/Ui/Button.vue": vue("<button />"),

    "apps/shop/pages/index.vue": vue(`
  <div>
    <Hero />
    <Hero></Hero>
    <user-card></user-card>
    <UiButton />
    <ui-button />
    <Plain />
    <BaseCard />
    <BaseBtn />
    <Dup />
    <LazyHero />
    <NuxtLink to="/" />
    <client-only><span /></client-only>
    <!-- <Hidden /> -->
  </div>`),
    "apps/shop/pages/explicit.vue": vue("<UserCard /><user-card />", `import UserCard from "../components/Special.vue"`),
    "apps/shop/pages/about.vue": "<template>\n  <Hero />\n</template>\n",
    "apps/shop/pages/nested.vue": vue(`
  <div>
    <template v-if="title">
      <span />
    </template>
    <Hero />
  </div>`),
    "layers/base/components/Wrapper.vue": vue("<BaseCard /><UiButton />"),
};

function renderTargets(file: string): Array<[string, string]> {
    return [...graph.edges.values()]
        .filter(edge => edge.type === "RENDERS_COMPONENT" && edge.from.startsWith(`js:nuxt/${file}::`))
        .map(edge => [edge.via ?? "", edge.to.replace(/^js:nuxt\//, "")] as [string, string])
        .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
}

function testNameRules(): void {
    const dir = { path: "components/", ignore: [], extensions: ["vue"], priority: 1 };
    assert.deepEqual(splitByCase("BaseBtn"), ["Base", "Btn"]);
    assert.equal(nuxtComponentName("components/user/Card.vue", dir)?.name, "UserCard");
    assert.equal(nuxtComponentName("components/base/BaseBtn.vue", dir)?.name, "BaseBtn");
    assert.equal(nuxtComponentName("components/user/profile/index.vue", dir)?.name, "UserProfile");
    assert.equal(nuxtComponentName("components/user/Card.vue", { ...dir, pathPrefix: false })?.name, "Card");
    assert.equal(nuxtComponentName("components/user/profile/index.vue", { ...dir, pathPrefix: false })?.name, "Profile");
    assert.equal(nuxtComponentName("components/UiButton.vue", { ...dir, prefix: "Ui" })?.name, "UiButton");
    assert.equal(nuxtComponentName("components/forms/Input.vue", { ...dir, prefix: "Ui" })?.name, "UiFormsInput");
    assert.deepEqual(nuxtComponentName("components/Map.client.vue", dir), { name: "Map", mode: "client" });
}

function testScanFixture(): void {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nuxt-components-"));
    try {
        for (const [file, contents] of Object.entries(fixture)) {
            fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
            fs.writeFileSync(path.join(root, file), contents);
        }
        resetGraph();
        processJsFiles(
            Object.keys(fixture).map(file => ({ absolutePath: path.join(root, file), relativePath: `nuxt/${file}` })),
            createJsParser(),
            { linkCrossLanguageEndpoints: false },
        );

        assert.deepEqual(renderTargets("apps/shop/pages/index.vue"), [
            ["BaseBtn", "apps/shop/components/base/BaseBtn.vue"],
            ["BaseCard", "layers/base/components/BaseCard.vue"],
            ["Hero", "apps/shop/components/Hero.vue"],
            ["LazyHero", "apps/shop/components/Hero.vue"],
            ["Plain", "apps/shop/flat/deep/Plain.vue"],
            ["UiButton", "layers/ui/components/Button.vue"],
            ["UserCard", "apps/shop/components/user/Card.vue"],
        ], "Pascal, kebab, nested, custom prefix, pathPrefix false and layer components link; duplicates, built-ins and commented tags do not");

        const hero = [...graph.edges.values()].find(edge => edge.via === "Hero" && edge.from.includes("pages/index.vue"))!;
        assert.equal(hero.confidence, 0.9);
        assert.match(hero.reason ?? "", /Nuxt auto-imported component <Hero>/);

        assert.deepEqual(
            renderTargets("apps/shop/pages/explicit.vue"),
            [["UserCard", "apps/shop/components/Special.vue"]],
            "an explicit import wins over the auto-imported UserCard for both tag spellings",
        );
        const explicitEdge = [...graph.edges.values()].find(edge => edge.type === "RENDERS_COMPONENT" && edge.from.includes("pages/explicit.vue"))!;
        assert.equal(explicitEdge.confidence, 0.98);

        assert.deepEqual(
            renderTargets("apps/shop/pages/about.vue"),
            [["Hero", "apps/shop/components/Hero.vue"]],
            "template-only SFCs are scanned",
        );
        assert.deepEqual(
            renderTargets("apps/shop/pages/nested.vue"),
            [["Hero", "apps/shop/components/Hero.vue"]],
            "tags after a nested <template v-if> block are part of the template",
        );

        assert.deepEqual(
            renderTargets("layers/base/components/Wrapper.vue"),
            [["BaseCard", "layers/base/components/BaseCard.vue"]],
            "a layer component links only when every app using the layer resolves the tag to the same file",
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
        resetGraph();
    }
}

testNameRules();
testScanFixture();
console.log("nuxt component auto-import tests passed");
