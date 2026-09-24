import assert from "node:assert/strict";
import type Parser from "tree-sitter";
import { createTsParser } from "../../../../src/scanner/js/ts/parser";
import { createWalkContext } from "../../../../src/scanner/js/walk/jsWalker";
import { extractHttpClientEndpoint } from "../../../../src/scanner/js/resolvers/httpClientCallExtractor";
import {
    registerHttpResource,
    resetHttpResourceRegistry,
} from "../../../../src/scanner/js/resolvers/httpResourceRegistry";

function parseCall(source: string): Parser.SyntaxNode {
    const tree = createTsParser().parse(source);
    let callNode: Parser.SyntaxNode | null = null;
    const visit = (node: Parser.SyntaxNode): void => {
        if (node.type === "call_expression" && !callNode) callNode = node;
        node.children.forEach(visit);
    };
    visit(tree.rootNode);
    assert.ok(callNode);
    return callNode!;
}

resetHttpResourceRegistry();
registerHttpResource("js/api/index.js", "s3Buckets", { urlTemplate: "/s3-buckets/{id}" });

const context = createWalkContext("js/views/S3BucketForm.vue");
context.imports.set("API", "js/api/index.js");

assert.deepEqual(
    extractHttpClientEndpoint(parseCall("API.s3Buckets.create(form)"), context),
    { method: "POST", path: "/s3-buckets", via: "API.s3Buckets.create" },
    "resource create posts to the collection URL",
);
assert.deepEqual(
    extractHttpClientEndpoint(parseCall("API.s3Buckets.update(form)"), context),
    { method: "PUT", path: "/s3-buckets/{param}", via: "API.s3Buckets.update" },
    "resource update keeps the member URL",
);
assert.deepEqual(
    extractHttpClientEndpoint(parseCall("API.s3Buckets.fetch(id)"), context),
    { method: "GET", path: "/s3-buckets/{param}", via: "API.s3Buckets.fetch" },
);

resetHttpResourceRegistry();
console.log("http resource call tests passed");
