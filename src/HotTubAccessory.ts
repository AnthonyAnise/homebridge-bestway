import {Service, PlatformAccessory, CharacteristicValue} from 'homebridge'

import {LayZSpaWhirlpool} from './platform'
import fetch, {Headers} from 'node-fetch'

export interface HotTubState {
    power: boolean,
    currentTemp: number,
    targetTemp: number,
    heatingOn: boolean,
    filterOn: boolean,
    wavesOn: boolean,
    lastFetch: Date
}

export class HotTubAccessory {
    private heatingService: Service
    private waveService: Service
    private filterService: Service

    private currentState: HotTubState = {
        power: false,
        currentTemp: 25,
        targetTemp: 30,
        heatingOn: false,
        filterOn: false,
        wavesOn: false,
        lastFetch: new Date(0)
    }

    constructor (
    private readonly platform: LayZSpaWhirlpool,
    private readonly accessory: PlatformAccessory,
    ) {
        this.platform.log.info('Initializing Lay-Z accessory')
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
        .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Bestway')
        .setCharacteristic(this.platform.Characteristic.Model, 'Lay-Z')
        .setCharacteristic(this.platform.Characteristic.SerialNumber, 'P05335')

    this.heatingService = this.accessory.getService(this.platform.Service.HeaterCooler) || this.accessory.addService(this.platform.Service.HeaterCooler)
    this.heatingService.setCharacteristic(this.platform.Characteristic.Name, 'Heating')

    this.waveService = this.accessory.getService(this.platform.Service.Outlet) || this.accessory.addService(this.platform.Service.Outlet)
    this.waveService.setCharacteristic(this.platform.Characteristic.Name, 'Waves')

    this.filterService = this.accessory.getService(this.platform.Service.Outlet) || this.accessory.addService(this.platform.Service.Outlet)
    this.filterService.setCharacteristic(this.platform.Characteristic.Name, 'Filter')

    this.heatingService
        .getCharacteristic(this.platform.Characteristic.On)
        .onGet(this.getOnState.bind(this))
        .onSet(this.setOnState.bind(this))

    this.heatingService
        .getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
        .onGet(this.getCurrentHeaterState.bind(this))
        .onSet(this.setCurrentHeaterState.bind(this))
        .setProps({
            maxValue: this.platform.Characteristic.CurrentHeaterCoolerState.HEATING,
            validValues: [
                this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE,
                this.platform.Characteristic.CurrentHeaterCoolerState.HEATING,
            ],
        })

    this.heatingService
        .getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
        .onGet(this.getHeatingTargetTemp.bind(this))
        .onSet(this.setHeatingTargetTemp.bind(this))
        .setProps({
            minValue: 20,
            maxValue: 40,
            minStep: 1
        })

    this.heatingService
        .getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
        .setProps({
            maxValue: this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS,
            validValues: [
                this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS
            ]
        })
        .setValue(this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS)

    this.heatingService
        .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .onGet(this.getCurrentTemperature.bind(this))

    this.waveService
        .getCharacteristic(this.platform.Characteristic.On)
        .onGet(this.getWaveOnState.bind(this))
        .onSet(this.setWaveOnState.bind(this))

    this.filterService
        .getCharacteristic(this.platform.Characteristic.On)
        .onGet(this.getFilterOnState.bind(this))
        .onSet(this.setFilterOnState.bind(this))

    setInterval(async () => {
        await this.getCurrentStatus()
    }, 10000)
    }

    getHeader (): Headers {
        const h = {} as Headers
        h.set('Content-Type', 'application/x-www-form-urlencoded')
        h.set('X-Requested-With', 'com.wiltonbradley.layzspa')
        h.set('User-Agent', 'Mozilla/5.0 (Linux; Android 7.1.2; SM-G930L Build/N2G48H; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/75.0.3770.143 Mobile Safari/537.36)')
        return h
    }

    async getCurrentStatus (): Promise<HotTubState> {
        if (((new Date().getTime() - this.currentState.lastFetch.getTime()) / 1000) < (60 * 1000)) {
            this.platform.log.debug('Last fetch was just a few minutes ago, using last state')
            return this.currentState
        }
        try {
            const response = await fetch(this.platform.baseUrl + `gizwits/status?api_token=${this.platform.apiToken}&did=${this.platform.deviceId}`,
                {
                    method: 'POST',
                    headers: this.getHeader()
                })
            if (!response.ok) {
                this.platform.log.error(`Could not retrieve device status. Status ${response.status}`)
                return this.currentState
            }
            const result = await response.json()
            this.currentState.power = result.data.attr.power as boolean
            this.currentState.currentTemp = result.data.attr.temp_now
            this.currentState.targetTemp = result.data.attr.temp_set
            this.currentState.heatingOn = result.data.attr.heat_power as boolean
            this.currentState.filterOn = result.data.attr.filter_power as boolean
            this.currentState.wavesOn = result.data.attr.wave_power as boolean
            this.currentState.lastFetch = new Date()

            return this.currentState
        } catch (e) {
            this.platform.log.error('Something went wrong while trying to get stauts of device', e)
            return this.currentState
        }
    }

    async setOnState (value: CharacteristicValue) {
        this.platform.log.debug('Set Characteristic On ->', value)
        this.currentState.power = value as boolean
        const targetState = this.currentState.power ? 'turn_on' : 'turn_off'
        await fetch(this.platform.baseUrl + `gizwits/${targetState}?api_token=${this.platform.apiToken}&did=${this.platform.deviceId}`, {
            method: 'POST',
            headers: this.getHeader()
        })
    }

    getOnState (): CharacteristicValue {
        return this.currentState.power
    }

    getCurrentTemperature (): CharacteristicValue {
        return this.currentState.currentTemp
    }

    async setHeatingTargetTemp (value: CharacteristicValue) {
        this.platform.log.debug('Set Characteristic Temperature -> ', value)
        this.currentState.targetTemp = value as number
        await fetch(this.platform.baseUrl + `gizwits/temp_set?api_token=${this.platform.apiToken}&did=${this.platform.deviceId}&temperature=${this.currentState.targetTemp}`, {
            method: 'POST',
            headers: this.getHeader()
        })
    }

    getCurrentHeaterState (): CharacteristicValue {
        return this.currentState.heatingOn
            ? this.platform.Characteristic.CurrentHeaterCoolerState.HEATING
            : this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE
    }

    async setCurrentHeaterState (value: CharacteristicValue) {
        this.platform.log.debug('Set Characteristic Filter and Heating ->', value)
        this.currentState.filterOn = value as boolean
        this.currentState.heatingOn = value as boolean
        const targetFilterState = this.currentState.heatingOn ? 'turn_filter_on' : 'turn_filter_off'
        const targetHeatingState = this.currentState.heatingOn ? 'turn_heat_on' : 'turn_heat_off'

        const response = await fetch(this.platform.baseUrl + `gizwits/${targetFilterState}?api_token=${this.platform.apiToken}&did=${this.platform.deviceId}`, {
            method: 'POST',
            headers: this.getHeader()
        })
        if (!response.ok) {
            this.platform.log.error('Could not set filter state, to avoid damage to the whirlpool heating will not be turned on.')
            return
        }
        await fetch(this.platform.baseUrl + `gizwits/${targetHeatingState}?api_token=${this.platform.apiToken}&did=${this.platform.deviceId}`, {
            method: 'POST',
            headers: this.getHeader()
        })
    }

    getHeatingTargetTemp (): CharacteristicValue {
        return this.currentState.targetTemp
    }

    getWaveOnState (): CharacteristicValue {
        return this.currentState.wavesOn
    }

    async setWaveOnState (value: CharacteristicValue) {
        this.platform.log.debug('Set Characteristic Waves -> ', value)
        this.currentState.wavesOn = value as boolean
        const targetState = this.currentState.wavesOn ? 'turn_wave_on' : 'turn_wave_off'
        await fetch(this.platform.baseUrl + `gizwits/${targetState}?api_token=${this.platform.apiToken}&did=${this.platform.deviceId}`, {
            method: 'POST',
            headers: this.getHeader()
        })
    }

    getFilterOnState (): CharacteristicValue {
        return this.currentState.filterOn
    }

    async setFilterOnState (value: CharacteristicValue) {
        this.platform.log.debug('Set Characteristic Filter -> ', value)
        this.currentState.filterOn = value as boolean
        const targetState = this.currentState.filterOn ? 'turn_filter_on' : 'turn_filter_off'
        await fetch(this.platform.baseUrl + `gizwits${targetState}?api_token=${this.platform.apiToken}&did=${this.platform.deviceId}`, {
            method: 'POST',
            headers: this.getHeader()
        })
    }
}
