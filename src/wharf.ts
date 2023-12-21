import {AccountKit} from '@wharfkit/account'
import ContractKit from '@wharfkit/contract'
import SessionKit, {APIClient, Chains, Session} from '@wharfkit/session'
import {TransactPluginResourceProvider} from '@wharfkit/transact-plugin-resource-provider'
import {WalletPluginAnchor} from '@wharfkit/wallet-plugin-anchor'
import {WalletPluginScatter} from '@wharfkit/wallet-plugin-scatter'
import {WalletPluginTokenPocket} from '@wharfkit/wallet-plugin-tokenpocket'
import {WalletPluginWombat} from '@wharfkit/wallet-plugin-wombat'
import WebRenderer from '@wharfkit/web-renderer'
import {writable, type Writable} from 'svelte/store'

export const client = new APIClient({url: 'https://eos.greymass.com'})
export const accountKit = new AccountKit(Chains.EOS, {client})
export const contractKit = new ContractKit({
    client,
})

export const sessionKit = new SessionKit(
    {
        appName: 'Minter',
        chains: [Chains.EOS],
        ui: new WebRenderer({minimal: true}),
        walletPlugins: [
            new WalletPluginAnchor(),
            new WalletPluginTokenPocket(),
            new WalletPluginScatter(),
            new WalletPluginWombat(),
        ],
    },
    {
        transactPlugins: [new TransactPluginResourceProvider()],
    }
)

export const session: Writable<Session | undefined> = writable()

export async function login() {
    const result = await sessionKit.login()
    session.set(result.session)
}

export async function logout() {
    await sessionKit.logout()
    session.set(undefined)
}

export async function restore() {
    const restored = await sessionKit.restore()
    session.set(restored)
}
