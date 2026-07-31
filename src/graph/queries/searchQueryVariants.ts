export type QueryVariantSource =
    | "raw"
    | "token"
    | "pascal"
    | "kebab"
    | "snake"
    | "spaced"
    | "camel";

export interface QueryVariant {
    text: string;
    source: QueryVariantSource;
}

const MAX_VARIANTS = 12;
const MIN_TOKEN_LENGTH = 2;

function capitalizeWord(value: string): string {
    if (!value) {
        return value;
    }
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export function splitQueryParts(raw: string): string[] {
    return raw
        .trim()
        .split(/[\s/:.\\_-]+/)
        .filter(part => part.length >= MIN_TOKEN_LENGTH);
}

export function splitCamelCase(value: string): string[] {
    return value
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .split(/[\s/:.\\_-]+/)
        .filter(part => part.length >= MIN_TOKEN_LENGTH);
}

export function toPascalCase(parts: string[]): string {
    return parts.map(capitalizeWord).join("");
}

export function toCamelCase(parts: string[]): string {
    const pascal = toPascalCase(parts);
    return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

export function toKebabCase(parts: string[]): string {
    return parts.map(part => part.toLowerCase()).join("-");
}

export function toSnakeCase(parts: string[]): string {
    return parts.map(part => part.toLowerCase()).join("_");
}

export function toSpacedLowerCase(parts: string[]): string {
    return parts.map(part => part.toLowerCase()).join(" ");
}

function addVariant(
    variants: QueryVariant[],
    seen: Set<string>,
    text: string,
    source: QueryVariantSource,
): void {
    const normalized = text.trim();
    if (!normalized) {
        return;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key) || variants.length >= MAX_VARIANTS) {
        return;
    }

    seen.add(key);
    variants.push({ text: normalized, source });
}

export function buildSearchQueryVariants(raw: string): QueryVariant[] {
    const query = raw.trim();
    const variants: QueryVariant[] = [];
    const seen = new Set<string>();

    if (!query) {
        return variants;
    }

    addVariant(variants, seen, query, "raw");

    const delimiterParts = splitQueryParts(query);
    const camelParts = /[a-z][A-Z]/.test(query) || /[A-Z][a-z]/.test(query)
        ? splitCamelCase(query)
        : [];
    const parts = delimiterParts.length >= 2 ? delimiterParts : camelParts;

    if (parts.length >= 2) {
        addVariant(variants, seen, toPascalCase(parts), "pascal");
        addVariant(variants, seen, toCamelCase(parts), "camel");
        addVariant(variants, seen, toKebabCase(parts), "kebab");
        addVariant(variants, seen, toSnakeCase(parts), "snake");
        addVariant(variants, seen, toSpacedLowerCase(parts), "spaced");

        for (const part of parts) {
            addVariant(variants, seen, part, "token");
        }
    } else if (parts.length === 1) {
        const [part] = parts;
        addVariant(variants, seen, part, "token");

        if (/[a-z][A-Z]/.test(part)) {
            const splitParts = splitCamelCase(part);
            if (splitParts.length >= 2) {
                addVariant(variants, seen, toKebabCase(splitParts), "kebab");
                addVariant(variants, seen, toSpacedLowerCase(splitParts), "spaced");
                for (const splitPart of splitParts) {
                    addVariant(variants, seen, splitPart, "token");
                }
            }
        }
    }

    return variants;
}

export function suggestFollowUpQueries(raw: string): string[] {
    return buildSearchQueryVariants(raw)
        .filter(variant => variant.source === "raw" || variant.source === "pascal" || variant.source === "camel")
        .map(variant => variant.text)
        .slice(0, 5);
}

export const VARIANT_SCORE_BONUS: Record<QueryVariantSource, number> = {
    raw: 30,
    pascal: 25,
    camel: 20,
    kebab: 15,
    snake: 10,
    spaced: 5,
    token: 0,
};
