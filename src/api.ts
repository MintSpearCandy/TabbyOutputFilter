import { ConnectableProfile } from 'tabby-core'

export interface FilterOptions {
    /** Match pattern; empty string means pass-through (match all) */
    pattern: string
    /** Treat pattern as a regular expression instead of a literal substring */
    isRegex: boolean
    /** Case-sensitive matching */
    caseSensitive: boolean
    /** Show lines that do NOT match */
    invert: boolean
    /** Runtime id of the source tab, assigned by FilterRegistryService */
    sourceTabId: string|null
}

export interface FilterProfile extends ConnectableProfile {
    options: FilterOptions
}

export interface FilterHistoryEntry {
    pattern: string
    isRegex: boolean
    caseSensitive: boolean
    invert: boolean
    /** Epoch ms, used for ordering */
    lastUsed: number
}

export function makeFilterProfile (options: Partial<FilterOptions>): FilterProfile {
    return {
        id: `filter:${Date.now().toString(36)}`,
        type: 'filter',
        name: 'Filter',
        group: '',
        options: {
            pattern: '',
            isRegex: false,
            caseSensitive: false,
            invert: false,
            sourceTabId: null,
            ...options,
        },
        icon: 'fas fa-filter',
        color: null,
        disableDynamicTitle: false,
        behaviorOnSessionEnd: 'keep',
        weight: 0,
        isBuiltin: false,
        isTemplate: false,
        clearServiceMessagesOnConnect: false,
    } as FilterProfile
}

export function historyEntryKey (entry: Pick<FilterHistoryEntry, 'pattern'|'isRegex'|'caseSensitive'|'invert'>): string {
    return `${entry.pattern}|${entry.isRegex}|${entry.caseSensitive}|${entry.invert}`
}
