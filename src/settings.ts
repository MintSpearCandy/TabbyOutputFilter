import { Injectable } from '@angular/core'
import { SettingsTabProvider } from 'tabby-settings'

import { FilterSettingsTabComponent } from './settingsTab.component'

/** @hidden */
@Injectable()
export class FilterSettingsTabProvider extends SettingsTabProvider {
    id = 'output-filter'
    icon = 'filter'
    title = 'Output Filter'

    getComponentType (): any {
        return FilterSettingsTabComponent
    }
}
