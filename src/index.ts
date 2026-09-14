import { NgModule } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import TabbyCoreModule, { ConfigProvider, HotkeyProvider, ProfileProvider, TabContextMenuItemProvider } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'
import TabbyTerminalModule from 'tabby-terminal'

import { FilterConfigProvider } from './config'
import { FilterContextMenuProvider } from './contextMenu'
import { FilterHotkeyProvider } from './hotkeys'
import { FilterProfileProvider } from './filterProfileProvider'
import { FilterSettingsTabProvider } from './settings'
import { FilterSettingsTabComponent } from './settingsTab.component'
import { FilterTabComponent } from './filterTab.component'

import './styles.scss'

@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        TabbyCoreModule,
        TabbyTerminalModule,
    ],
    providers: [
        { provide: ProfileProvider, useClass: FilterProfileProvider, multi: true },
        { provide: TabContextMenuItemProvider, useClass: FilterContextMenuProvider, multi: true },
        { provide: HotkeyProvider, useClass: FilterHotkeyProvider, multi: true },
        { provide: ConfigProvider, useClass: FilterConfigProvider, multi: true },
        { provide: SettingsTabProvider, useClass: FilterSettingsTabProvider, multi: true },
    ],
    declarations: [
        FilterTabComponent,
        FilterSettingsTabComponent,
    ],
    entryComponents: [
        FilterTabComponent,
        FilterSettingsTabComponent,
    ],
})
export default class FilterOutputModule { }
