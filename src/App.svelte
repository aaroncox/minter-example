<script lang="ts">
    import {onMount} from 'svelte'
    import {accountKit, contractKit, login, logout, restore, session} from './wharf'
    import {type Writable, writable, derived, type Readable} from 'svelte/store'
    import {SystemContract, type Account} from '@wharfkit/account'
    import {Asset, PrivateKey, Session, WalletPluginMetadata} from '@wharfkit/session'
    import {WalletPluginPrivateKey} from '@wharfkit/wallet-plugin-privatekey'

    const mintContract = 'greymassnoop'
    const mintAction = 'noop'
    const mintMemo = {p: 'eirc-20', op: 'mint', tick: 'rams', amt: 10}

    let account: Writable<Account | undefined> = writable()
    let balance: Writable<number> = writable(0)
    const sessionKey: Writable<PrivateKey | null> = writable()
    const localSession: Readable<Session | null> = derived(
        [session, sessionKey],
        ([$session, $key]) => {
            if ($session && $key) {
                return new Session(
                    {
                        actor: $session.actor,
                        permission: mintContract,
                        chain: $session.chain,
                        walletPlugin: new WalletPluginPrivateKey($key),
                    },
                    {
                        transactPlugins: $session.transactPlugins,
                    }
                )
            }
            return null
        }
    )

    let current: Writable<number> = writable(0)
    const percent: Readable<string> = derived(current, (c) => ((c / maximum) * 100).toFixed(3))
    const maximum = 1000000000

    const minting: Writable<boolean> = writable(false)

    onMount(async () => {
        await restore()
        await fetchAccount()
        const key = localStorage.getItem('sessionKey')
        if (key) {
            sessionKey.set(PrivateKey.from(key))
        }
    })

    async function fetchAccount() {
        if ($session) {
            account.set(await accountKit.load($session.actor))
        }
    }

    setTimeout(fetchAccount, 5000)
    setInterval(autoMint, 1000)
    setInterval(loadMints, 3000)

    async function loadMints() {
        if ($session) {
            const accountMints = await $session.client.v1.chain.get_table_rows({
                json: true,
                limit: 1,
                code: mintContract,
                scope: mintContract,
                table: 'users',
                lower_bound: $session.actor,
                upper_bound: $session.actor,
            })
            if (accountMints && accountMints.rows && accountMints.rows[0]) {
                balance.set(accountMints.rows[0].mintcount)
            }
            const totalMints = await $session.client.v1.chain.get_table_rows({
                json: true,
                limit: 1,
                code: mintContract,
                scope: mintContract,
                table: 'mints',
                reverse: true,
            })
            if (totalMints && totalMints.rows && totalMints.rows[0]) {
                current.set(totalMints.rows[0].id)
            }
        }
    }

    async function buyram() {
        if ($account && $session) {
            const action = await $account.buyRam('1.0000 EOS')
            await $session.transact({action})
            setTimeout(fetchAccount, 500)
        }
    }

    async function powerup() {
        if ($account && $session) {
            // Retrieve pricing
            const resources = $account.resources()
            const state = await resources.v1.powerup.get_state()
            const sample = await resources.getSampledUsage()
            // CPU
            const cpu_price = state.cpu.price_per(sample, 10000)
            const cpu_frac = state.cpu.frac(sample, 10000)
            // NET
            const net_price = state.net.price_per(sample, 10000)
            const net_frac = state.net.frac(sample, 10000)

            const max_payment = Asset.from(Number(cpu_price) + Number(net_price), '4,EOS')

            const contract = await contractKit.load('eosio')
            const action = contract.action('powerup', {
                payer: $session.actor,
                receiver: $session.actor,
                days: 1,
                net_frac,
                cpu_frac,
                max_payment,
            })

            await $session.transact({action})
            setTimeout(fetchAccount, 500)
        }
    }

    async function mint() {
        if ($session) {
            if ($localSession) {
                await $localSession.transact({
                    action: {
                        account: mintContract,
                        name: mintAction,
                        authorization: [$localSession?.permissionLevel],
                        data: {
                            from: $localSession.actor,
                            memo: JSON.stringify(mintMemo),
                        },
                    },
                })
            } else {
                await $session.transact({
                    action: {
                        account: mintContract,
                        name: mintAction,
                        authorization: [$session?.permissionLevel],
                        data: {
                            from: $session.actor,
                            memo: JSON.stringify(mintMemo),
                        },
                    },
                })
            }
        }
    }

    function autoMint() {
        if ($minting) {
            mint()
        }
    }

    function startmint() {
        minting.set(true)
    }

    function stopmint() {
        minting.set(false)
    }

    async function requestPermission() {
        if ($session) {
            const key = PrivateKey.generate('K1')
            await $session.transact({
                actions: [
                    {
                        account: 'eosio',
                        name: 'updateauth',
                        authorization: [$session.permissionLevel],
                        data: {
                            account: $session.actor,
                            permission: mintContract,
                            parent: 'active',
                            auth: {
                                threshold: 1,
                                keys: [{key: key.toPublic(), weight: 1}],
                                accounts: [],
                                waits: [],
                            },
                            authorized_by: `${$session.permission}`,
                        },
                    },
                    {
                        account: 'eosio',
                        name: 'linkauth',
                        authorization: [$session.permissionLevel],
                        data: {
                            account: $session.actor,
                            code: mintContract,
                            type: mintAction,
                            requirement: mintContract,
                            authorized_by: `${$session.permission}`,
                        },
                    },
                ],
            })
            localStorage.setItem('sessionKey', key.toString())
            sessionKey.set(key)
        }
    }

    async function removePermission() {
        if ($session) {
            await $session.transact({
                actions: [
                    {
                        account: 'eosio',
                        name: 'unlinkauth',
                        authorization: [$session.permissionLevel],
                        data: {
                            account: $session.actor,
                            code: mintContract,
                            type: mintAction,
                            authorized_by: `${$session.permission}`,
                        },
                    },
                    {
                        account: 'eosio',
                        name: 'deleteauth',
                        authorization: [$session.permissionLevel],
                        data: {
                            account: $session.actor,
                            permission: mintContract,
                            authorized_by: `${$session.permission}`,
                        },
                    },
                ],
            })
            localStorage.removeItem('sessionKey')
            sessionKey.set(null)
        }
    }
</script>

<header>
    <hgroup>
        <h1>RAMS Minter</h1>
        <h1>A better minter for ramseos.io</h1>
    </hgroup>
</header>

<main>
    {#if $session}
        <article>
            <div class="grid">
                <div>
                    <hgroup>
                        <h2>{$balance}</h2>
                        <h5>Your EIRC20</h5>
                    </hgroup>
                </div>
                <div>
                    <hgroup>
                        <h2>{$percent}%</h2>
                        <h5>Distributed</h5>
                    </hgroup>
                </div>
            </div>
            <footer>
                <div class="grid">
                    <div>
                        {#if $minting}
                            <button class="outline" on:click={stopmint}>Stop Minting</button>
                        {:else}
                            <button on:click={mint}>Mint</button>
                            {#if $sessionKey}
                                <button on:click={startmint}>Automatically Mint</button>
                            {:else}
                                <button disabled>Automatically Mint (Disabled)</button>
                                <p>
                                    To enable the automatic mint feature, see below on how to create
                                    a Session Key.
                                </p>
                            {/if}
                        {/if}
                    </div>
                    <div>
                        <div class="grid">
                            <div>
                                <hgroup>
                                    <h4>{$session.actor}</h4>
                                    <h5>Account</h5>
                                </hgroup>
                            </div>
                            <div>
                                <button class="outline secondary" on:click={logout}>Logout</button>
                            </div>
                        </div>
                        {#if $account}
                            <div class="grid">
                                <div>
                                    <hgroup>
                                        <h4>{$account.resource('cpu').available} us</h4>
                                        <h5>CPU</h5>
                                    </hgroup>
                                </div>
                                <div>
                                    <button class="outline" on:click={powerup}>Powerup</button>
                                </div>
                            </div>
                            <div class="grid">
                                <div>
                                    <hgroup>
                                        <h4>{$account.resource('ram').available} bytes</h4>
                                        <h5>RAM</h5>
                                    </hgroup>
                                </div>
                                <div>
                                    <button class="outline" on:click={buyram}>Buy RAM</button>
                                </div>
                            </div>
                        {/if}
                    </div>
                </div>
            </footer>
        </article>
        <article>
            <h2>Session Key</h2>
            {#if $sessionKey}
                <h3>Active</h3>
                <p>Session Key: {$sessionKey.toPublic()}</p>
            {:else}
                <p>
                    To automatically mint without needing to approve in your wallet you can create a
                    Session Key. This will create a key in your web browser that will be used to
                    sign transactions automatically.
                </p>
                <p>
                    Your wallet may indicate that this is a dangerous action (it can be). Check to
                    ensure the linkauth action only includes the minting contract and action, which
                    will restrict this key to only minting.
                </p>
                <button on:click={requestPermission}>Create Session Key</button>
            {/if}
            <button on:click={removePermission}>Remove Session Key</button>
        </article>
    {:else}
        <button on:click={login}>Login</button>
    {/if}
</main>

<style>
</style>
