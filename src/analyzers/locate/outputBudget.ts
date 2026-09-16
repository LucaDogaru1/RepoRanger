export const DEFAULT_MAX_TOKENS = 800;
export const MIN_MAX_TOKENS = 200;

export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.5);
}

export interface BudgetSection {
    priority: number;
    lines: string[];
    keepLines?: number;
    droppable?: boolean;
}

export interface BudgetResult {
    text: string;
    tokens: number;
    trimmed: boolean;
}

type WorkingSection = BudgetSection & { order: number };

function render(sections: WorkingSection[]): string {
    return sections
        .filter(section => section.lines.length > 0)
        .map(section => section.lines.join("\n"))
        .join("\n");
}

function trimTargets(sections: WorkingSection[]): WorkingSection[] {
    return sections
        .filter(section => section.lines.length > 0)
        .sort((left, right) => left.priority - right.priority || right.order - left.order);
}

export function applyOutputBudget(sections: BudgetSection[], maxTokens: number): BudgetResult {
    const budget = Math.max(MIN_MAX_TOKENS, maxTokens);
    const working: WorkingSection[] = sections.map((section, order) => ({
        ...section,
        lines: [...section.lines],
        order,
    }));
    let trimmed = false;

    while (estimateTokens(render(working)) > budget) {
        const candidates = trimTargets(working);

        const shrinkable = candidates.find(section =>
            section.lines.length - (section.keepLines ?? 0) >= 2);

        if (shrinkable) {
            shrinkable.lines.pop();
            trimmed = true;
            continue;
        }

        const removable = candidates.find(section => section.droppable !== false);
        if (!removable) {
            break;
        }

        removable.lines = [];
        trimmed = true;
    }

    const text = render(working);
    return { text, tokens: estimateTokens(text), trimmed };
}
