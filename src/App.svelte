<script lang="ts">
    import {onMount} from 'svelte'
    import {accountKit, contractKit, login, logout, restore, session, url} from './wharf'
    import {type Writable, writable, derived, type Readable} from 'svelte/store'
    import {type Account} from '@wharfkit/account'
    import {Asset, PrivateKey, Session} from '@wharfkit/session'
    import {WalletPluginPrivateKey} from '@wharfkit/wallet-plugin-privatekey'

    const mintContract = 'rams.eos'
    const mintAction = 'mint'
    const mintMemo = {p: 'eirc-20', op: 'mint', tick: 'rams', amt: 10}

    let account: Writable<Account | undefined> = writable()
    let balance: Writable<number> = writable(0)
    const sessionKey: Writable<PrivateKey | null> = writable()
    const localSession: Readable<Session | null> = derived(
        [session, sessionKey],
        ([$session, $key]) => {
            if ($session && $key) {
                return new Session({
                    actor: $session.actor,
                    permission: mintContract,
                    chain: $session.chain,
                    walletPlugin: new WalletPluginPrivateKey($key),
                })
            }
            return null
        }
    )

    let current: Writable<number> = writable(0)
    const percent: Readable<string> = derived(current, (c) => ((c / maximum) * 100).toFixed(3))
    const maximum = 100000000

    const minting: Writable<boolean> = writable(false)
    const lastMintId: Writable<string> = writable()
    const lastMintTime: Writable<string> = writable()
    const lastMintError: Writable<string> = writable()

    onMount(async () => {
        await restore()
        await fetchAccount()
        await loadMints()
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

    setInterval(autoMint, 1000)
    setInterval(loadMints, 3000)
    setInterval(fetchAccount, 5000)

    async function loadMints() {
        if ($session && mintContract) {
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
                table: 'status',
                reverse: true,
            })
            if (totalMints && totalMints.rows && totalMints.rows[0]) {
                current.set(totalMints.rows[0].minted)
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
            const cpu_price = state.cpu.price_per(sample, 100000)
            const cpu_frac = state.cpu.frac(sample, 100000)
            // NET
            const net_price = state.net.price_per(sample, 100000)
            const net_frac = state.net.frac(sample, 100000)

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
            let result
            try {
                // Random expiration seconds to help prevent duplicate transactions
                const expireSeconds = Math.floor(Math.random() * (3600 - 60 + 1)) + 60
                if ($localSession) {
                    result = await $localSession.transact(
                        {
                            actions: [...Array(quantity)].map(() => {
                                return {
                                    account: mintContract,
                                    name: mintAction,
                                    authorization: [$localSession?.permissionLevel],
                                    data: {
                                        from: $localSession.actor,
                                        memo: JSON.stringify(mintMemo),
                                    },
                                }
                            }),
                        },
                        {
                            expireSeconds,
                        }
                    )
                } else {
                    result = await $session.transact(
                        {
                            actions: [...Array(quantity)].map(() => {
                                return {
                                    account: mintContract,
                                    name: mintAction,
                                    authorization: [$session?.permissionLevel],
                                    data: {
                                        from: $session.actor,
                                        memo: JSON.stringify(mintMemo),
                                    },
                                }
                            }),
                        },
                        {
                            expireSeconds,
                        }
                    )
                }
                balance.update((b) => b + quantity)
                lastMintError.set('')
                if (result && result.response) {
                    lastMintId.set(result.response.transaction_id)
                    lastMintTime.set(result.response.processed.block_time)
                }
            } catch (e) {
                lastMintError.set(String(e))
                if (!String(e).includes('duplicate')) {
                    minting.set(false)
                }
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

    let quantity = 1

    function changeQuantity(e) {
        quantity = Number(e.target.value)
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
                <div class="center padded">
                    <div>
                        <hgroup>
                            <h1>{$balance}</h1>
                            <h5>Your EIRC20</h5>
                        </hgroup>
                    </div>
                    <div>
                        <progress value={$percent} max="100"></progress>
                        <hgroup class="center">
                            <h5>{$percent}%</h5>
                            <h6>Distribution Completed</h6>
                        </hgroup>
                    </div>
                </div>

                <div>
                    <p>
                        Mint EIRC20 using the controls below. Each mint transaction will consume CPU
                        and RAM to perform the mint actions.
                    </p>

                    <select on:change={changeQuantity}>
                        <option value="1">1x Mints</option>
                        <option value="10">10x Mints</option>
                        <option value="100">100x Mints</option>
                        <option value="1000">1000x Mints</option>
                    </select>
                    {#if mintContract}
                        {#if $minting}
                            <button class="outline" on:click={stopmint}>Stop Minting</button>
                        {:else}
                            <button on:click={mint}>Mint</button>
                            {#if $sessionKey}
                                <button on:click={startmint}>Automatically Mint</button>
                            {:else}
                                <button disabled>Automatically Mint (Disabled)</button>
                                <p>
                                    To enable the automatic mint feature, read the bottom of the
                                    page and create a Session Key for minting.
                                </p>
                            {/if}
                        {/if}
                        <div>
                            {#if $lastMintError}
                                <hgroup class="red">
                                    <h6>Error</h6>
                                    <h6>
                                        {$lastMintError}
                                    </h6>
                                </hgroup>
                            {:else}
                                <hgroup>
                                    <h6>
                                        {#if $lastMintTime}
                                            Successfully minted @ {$lastMintTime}
                                        {/if}
                                    </h6>
                                    <h6>
                                        {#if $lastMintId}
                                            {$lastMintId}
                                        {/if}
                                    </h6>
                                </hgroup>
                            {/if}
                        </div>
                    {:else}
                        <hgroup>
                            <h3>Disabled</h3>
                            <p>Awaiting contract release</p>
                        </hgroup>

                        <button disabled>Mint</button>
                        <button disabled>Automatically Mint</button>
                    {/if}
                </div>
            </div>
            <footer>
                <p>Rent additional CPU or purchase additional RAM.</p>
                <div class="grid">
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
                                    <button class="outline" on:click={powerup}>Powerup 100ms</button
                                    >
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
                                    <button class="outline" on:click={buyram}
                                        >Buy 1 EOS worth of RAM</button
                                    >
                                </div>
                            </div>
                        {:else}
                            <div class="center red">
                                <h2>Unable to load account</h2>
                            </div>
                        {/if}
                    </div>
                </div>
            </footer>
        </article>
        <article>
            <h2>Change API Node</h2>
            <form>
                <label>
                    <span>API Node</span>
                    <input name="node" type="text" placeholder={url} />
                </label>
                <button type="submit" class="outline">Change</button>
            </form>
        </article>
        <article>
            <h2>Session Key</h2>
            {#if $sessionKey}
                <h3>Enabled</h3>
                <p>Session Key: {$sessionKey.toPublic()}</p>
                <p>If your session key is not working, remove it and re-add it.</p>
            {:else if mintContract}
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
            <button class="outline" on:click={removePermission}>Remove Session Key</button>
        </article>
    {:else}
        <button on:click={login}>Login</button>
    {/if}
</main>

<header>
    <p>
        <strong>Disclaimer</strong>: This app is not an endorsement of the inscription event or of
        ramseos.io. This app was built to offer more inclusive options for participation and to
        serve as an example of how to better build these apps. It is however a fully functional app
        that can be used to participate in the inscription event and was built using the new
        <a href="https://wharfkit.com">Wharf SDKs</a>. Source code is
        <a href="https://github.com/aaroncox/minter-example">here</a>.
    </p>
    <p>Use this app to create inscriptions at your own risk.</p>
</header>

<style>
    .center {
        text-align: center;
    }
    .right {
        text-align: right;
    }
    .padded {
        padding: 0 4rem;
    }
    .red * {
        color: red;
    }
</style>
