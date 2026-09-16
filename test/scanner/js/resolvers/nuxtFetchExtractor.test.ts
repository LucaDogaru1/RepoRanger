import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { graph, resetGraph } from "../../../../src/graph/graph";
import { createTsParser } from "../../../../src/scanner/js/ts/parser";
import walk, { createWalkContext } from "../../../../src/scanner/js/walk/jsWalker";
import {
    extractFetchEndpoint,
    isDirectFetchCallee,
    normalizeInferredFetchPath,
} from "../../../../src/scanner/js/resolvers/fetchEndpointExtractor";

function parseCall(source: string) {
    const parser = createTsParser();
    const tree = parser.parse(source);
    assert.equal(tree.rootNode.hasError, false, `parse error in fixture: ${source}`);

    let callNode: import("tree-sitter").SyntaxNode | null = null;
    const visit = (node: import("tree-sitter").SyntaxNode): void => {
        if (node.type === "call_expression" && !callNode) {
            callNode = node;
        }
        for (const child of node.children) {
            visit(child);
        }
    };
    visit(tree.rootNode);
    assert.ok(callNode, `expected call_expression in: ${source}`);
    return callNode!;
}

function testDirectFetchCallees(): void {
    assert.equal(isDirectFetchCallee("fetch"), true);
    assert.equal(isDirectFetchCallee("$fetch"), true);
    assert.equal(isDirectFetchCallee("useFetch"), true);
    assert.equal(isDirectFetchCallee("axios"), false);
}

function testNormalizeInferredFetchPath(): void {
    assert.equal(
        normalizeInferredFetchPath("{param}api/v3/cleeng/user"),
        "/api/v3/cleeng/user"
    );
    assert.equal(
        normalizeInferredFetchPath("/api/v3/modules/{param}/contents"),
        "/api/v3/modules/{param}/contents"
    );
}

function testExtractFromTemplateString(): void {
    const callNode = parseCall('$fetch(`${normalizeUrl(host)}api/v3/cleeng/user`, { method: "GET" })');
    const context = createWalkContext("fixture.ts");
    const endpoint = extractFetchEndpoint(callNode, context);

    assert.deepEqual(endpoint, {
        method: "GET",
        path: "/api/v3/cleeng/user",
    });
}

function testExtractFromComputedUrlViaUnref(): void {
    const source = `
const url = computed(() => \`\${normalizeUrl(host)}api/v3/cleeng/user\`);
const fetchUser = async () => {
  await $fetch(unref(url), { method: "GET" });
};
`;
    const parser = createTsParser();
    const tree = parser.parse(source);
    resetGraph();
    const context = createWalkContext("packages/payment/composables/useApiUser.ts");
    walk(tree.rootNode, context.file, context);

    const httpEdges = [...graph.edges.values()].filter(edge => edge.type === "HTTP_REQUEST");
    assert.equal(httpEdges.length, 1);
    assert.equal(httpEdges[0]?.to, "http:GET:/api/v3/cleeng/user");
    assert.equal(httpEdges[0]?.via, "$fetch");
}

function testExtractFromUseFetchMemberValue(): void {
    const source = `
const url = computed(() => \`\${normalizeUrl(host)}api/v3/pages/{param}\`);
const load = async () => {
  await useFetch(url.value, { deep: true });
};
`;
    const parser = createTsParser();
    const tree = parser.parse(source);
    resetGraph();
    const context = createWalkContext("packages/content/composables/usePage.ts");
    walk(tree.rootNode, context.file, context);

    const httpEdges = [...graph.edges.values()].filter(edge => edge.type === "HTTP_REQUEST");
    assert.equal(httpEdges.length, 1);
    assert.equal(httpEdges[0]?.to, "http:GET:/api/v3/pages/{param}");
    assert.equal(httpEdges[0]?.via, "useFetch");
}

function testExtractFromLocalUrlBuilder(): void {
    const source = `
const buildSearchUrl = (params) =>
  \`\${normalizeUrl(host)}api/v3/contents/search?\${apiQueryString(params)}\`;
const fullUrl = computed(() => buildSearchUrl(queryParams));
const load = async () => {
  await $fetch(buildSearchUrl(queryParams));
  await $fetch(unref(fullUrl));
};
`;
    const parser = createTsParser();
    const tree = parser.parse(source);
    resetGraph();
    const context = createWalkContext("packages/search/composables/useSearchApi.ts");
    walk(tree.rootNode, context.file, context);

    const httpEdges = [...graph.edges.values()].filter(edge => edge.type === "HTTP_REQUEST");
    assert.equal(httpEdges.length, 1);
    assert.equal(httpEdges[0]?.to, "http:GET:/api/v3/contents/search");
    assert.equal(httpEdges[0]?.via, "$fetch");
}

function testNuxtComposableFixturesWhenPresent(): void {
    const nuxtRoot = path.resolve(__dirname, "../../../../../../spott/nuxt");
    const fixtures = [
        "packages/payment/composables/useApiUser.ts",
        "packages/content/composables/useModuleContent.ts",
        "packages/search/composables/useSearchApi.ts",
    ];

    let checked = 0;
    for (const fixture of fixtures) {
        const absolutePath = path.join(nuxtRoot, fixture);
        if (!fs.existsSync(absolutePath)) {
            continue;
        }

        resetGraph();
        const source = fs.readFileSync(absolutePath, "utf8");
        const tree = createTsParser().parse(source);
        assert.equal(tree.rootNode.hasError, false, fixture);

        const context = createWalkContext(fixture);
        walk(tree.rootNode, fixture, context);

        const httpEdges = [...graph.edges.values()].filter(edge => edge.type === "HTTP_REQUEST");
        assert.ok(httpEdges.length >= 1, `expected HTTP_REQUEST in ${fixture}`);
        checked += 1;
    }

    if (checked === 0) {
        console.log("  ↷ Skipping Nuxt composable fixtures — spott/nuxt not found locally");
    }
}

function run(): void {
    console.log("nuxtFetchExtractor tests\n");

    testDirectFetchCallees();
    console.log("  ✓ recognizes fetch, $fetch, and useFetch");

    testNormalizeInferredFetchPath();
    console.log("  ✓ normalizes host-prefixed API paths");

    testExtractFromTemplateString();
    console.log("  ✓ extracts endpoint from $fetch template literal");

    testExtractFromComputedUrlViaUnref();
    console.log("  ✓ resolves computed URL through unref(url)");

    testExtractFromUseFetchMemberValue();
    console.log("  ✓ resolves computed URL through useFetch(url.value)");

    testExtractFromLocalUrlBuilder();
    console.log("  ✓ resolves local URL builders used by $fetch");

    testNuxtComposableFixturesWhenPresent();
    console.log("  ✓ Nuxt composable fixtures emit HTTP_REQUEST edges");

    console.log("\nAll nuxt fetch extractor tests passed.");
}

run();
