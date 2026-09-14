import { Injectable } from '@angular/core'
import { SettingsTabProvider } from 'tabby-settings'

import { FilterSettingsTabComponent } from './settingsTab.component'

/** @hidden */
@Injectable()
export class FilterSettingsTabProvider extends SettingsTabProvider {
    id = 'filter-output'
    icon = 'filter'
    title = 'Filter Output'

    getComponentType (): any {
        return FilterSettingsTabComponent
    }
}
