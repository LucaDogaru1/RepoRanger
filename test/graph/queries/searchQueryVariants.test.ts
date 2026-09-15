import assert from "node:assert/strict";
import {
    buildSearchQueryVariants,
    splitCamelCase,
    splitQueryParts,
    suggestFollowUpQueries,
    toPascalCase,
} from "../../../src/graph/queries/searchQueryVariants";

const promotionVariants = buildSearchQueryVariants("Promotion Element");
assert.ok(
    promotionVariants.some(variant => variant.text === "PromotionElement" && variant.source === "pascal"),
    "spaced label expands to PascalCase",
);
assert.ok(
    promotionVariants.some(variant => variant.text === "Promotion" && variant.source === "token"),
    "spaced label keeps token parts",
);

const paragraphVariants = buildSearchQueryVariants("paragraph-section");
assert.ok(
    paragraphVariants.some(variant => variant.text === "ParagraphSection" && variant.source === "pascal"),
    "kebab slug expands to PascalCase",
);
assert.ok(
    paragraphVariants.some(variant => variant.text === "paragraph" && variant.source === "token"),
    "kebab slug keeps token parts",
);

const classVariants = buildSearchQueryVariants("ParagraphSectionSettings");
assert.ok(
    classVariants.some(variant => variant.text === "paragraph-section-settings" && variant.source === "kebab"),
    "PascalCase expands to kebab-case",
);

assert.deepEqual(splitQueryParts("paragraph-section"), ["paragraph", "section"]);
assert.deepEqual(splitCamelCase("ParagraphSectionSettings"), ["Paragraph", "Section", "Settings"]);
assert.equal(toPascalCase(["paragraph", "section"]), "ParagraphSection");

const suggestions = suggestFollowUpQueries("paragraph-section");
assert.ok(suggestions.includes("ParagraphSection"), "suggestions include PascalCase variant");

console.log("searchQueryVariants tests passed");
