import { Injectable } from '@angular/core'
import { ConnectableProfileProvider, NewTabParameters, PartialProfile } from 'tabby-core'
import { FilterProfile } from './api'
import { FilterTabComponent } from './filterTab.component'

@Injectable({ providedIn: 'root' })
export class FilterProfileProvider extends ConnectableProfileProvider<FilterProfile> {
    id = 'output-filter'
    name = 'Output filter'
    configDefaults = {
        options: {
            pattern: '',
            isRegex: false,
            caseSensitive: false,
            invert: false,
            sourceTabId: null,
        },
    }

    async getBuiltinProfiles (): Promise<PartialProfile<FilterProfile>[]> {
        return [
            {
                id: 'output-filter:new',
                type: 'output-filter',
                name: 'Output filter',
                icon: 'fas fa-filter',
                isBuiltin: true,
                isTemplate: true,
            } as PartialProfile<FilterProfile>,
        ]
    }

    async getNewTabParameters (profile: FilterProfile): Promise<NewTabParameters<FilterTabComponent>> {
        return {
            type: FilterTabComponent,
            inputs: { profile },
        }
    }

    getSuggestedName (profile: FilterProfile): string|null {
        return profile.options.pattern ? `Filter: ${profile.options.pattern}` : 'Output filter'
    }

    getDescription (profile: FilterProfile): string {
        return profile.options.pattern ?? ''
    }
}
