<script lang="ts">
  import { mobile } from "../lib/platform";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { onMount, untrack } from "svelte";
  import { fade } from "svelte/transition";
  import Icon from "../components/Icon.svelte";
  import { CF_SIGNUP, CF_TOKEN_TEMPLATE, CHATGPT_MCP_HELP, CLAUDE_CONNECTORS, SITE_GUIDE } from "../lib/links";
  import { store } from "../lib/store.svelte";
  import type { Account, Inspection, SetupDone, SetupProgress, SetupStep } from "../lib/types";

  interface Props {
    /** new：第一次設定（或另一台電腦加入）；update：更新目前連線的雲端 */
    mode: "new" | "update";
    onfinish: () => void;
    /** 更新模式可以中途離開 */
    oncancel?: () => void;
  }
  let { mode, onfinish, oncancel }: Props = $props();

  type Page = "welcome" | "connect" | "account" | "deploy" | "done";
  // 模式在精靈開啟時就決定了，之後不會變
  let page = $state<Page>(untrack(() => mode) === "new" ? "welcome" : "connect");

  let busy = $state(false);
  let error = $state("");
  let waitingBrowser = $state(false);
  let showToken = $state(false);
  let token = $state("");

  let accounts = $state<Account[]>([]);
  let account = $state<Account | null>(null);
  let inspection = $state<Inspection | null>(null);
  let subdomain = $state("");

  const STEPS: { id: SetupStep; label: string }[] = [
    { id: "subdomain", label: "設定 workers.dev 網址" },
    { id: "database", label: "準備資料庫" },
    { id: "migrate", label: "建立資料表" },
    { id: "device", label: mobile ? "登記這支手機" : "登記這台電腦" },
    { id: "upload", label: "上傳 Deskdo 雲端程式" },
    { id: "route", label: "開啟網址" },
    { id: "verify", label: "確認連線" },
  ];
  let progress = $state<Partial<Record<SetupStep, SetupProgress>>>({});
  let result = $state<SetupDone | null>(null);
  let copied = $state(false);

  const AI_TABS = [
    { id: "claude", label: "Claude" },
    { id: "chatgpt", label: "ChatGPT" },
    { id: "other", label: "其他工具" },
  ] as const;
  let ai = $state<(typeof AI_TABS)[number]["id"]>("claude");

  const oauth = $derived(store.prefs?.oauthAvailable ?? false);
  const subdomainValid = $derived(/^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/.test(subdomain));
  const visibleSteps = $derived(STEPS.filter((s) => progress[s.id]?.state !== "skip" || s.id === "verify"));

  onMount(() => {
    const off = listen<SetupProgress>("setup-progress", (e) => {
      progress = { ...progress, [e.payload.step]: e.payload };
    });
    return () => {
      off.then((f) => f());
      if (page !== "done") invoke("setup_cancel");
    };
  });

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    busy = true;
    error = "";
    try {
      return await fn();
    } catch (e) {
      error = String(e);
      return undefined;
    } finally {
      busy = false;
    }
  }

  async function loginWithCloudflare() {
    waitingBrowser = true;
    const list = await run(() => invoke<Account[]>("setup_oauth"));
    waitingBrowser = false;
    if (list) await gotAccounts(list);
  }

  function cancelLogin() {
    invoke("setup_cancel");
  }

  async function connectToken() {
    const list = await run(() => invoke<Account[]>("setup_token", { token }));
    if (list) {
      token = "";
      await gotAccounts(list);
    }
  }

  async function gotAccounts(list: Account[]) {
    accounts = list;
    if (list.length === 1) {
      await chooseAccount(list[0]);
    } else {
      account = null;
      page = "account";
    }
  }

  async function chooseAccount(a: Account) {
    account = a;
    const info = await run(() => invoke<Inspection>("setup_inspect", { account: a }));
    if (!info) {
      page = "account";
      return;
    }
    inspection = info;
    subdomain = info.subdomain ?? info.suggestedSubdomain;
    // 只有一個帳號、也不用取子網域名稱時，直接開始
    if (accounts.length === 1 && info.subdomain) {
      deploy();
    } else {
      page = "account";
    }
  }

  async function deploy() {
    if (!account) return;
    page = "deploy";
    progress = {};
    const done = await run(() =>
      invoke<SetupDone>("setup_run", {
        accountId: account!.id,
        subdomain: inspection?.subdomain ? null : subdomain,
      }),
    );
    if (done) {
      result = done;
      page = "done";
    }
  }

  async function copy() {
    if (!result?.connectorUrl) return;
    await navigator.clipboard.writeText(result.connectorUrl);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<div class="setup">
  <div class="panel">
    {#if page === "welcome"}
      <section in:fade={{ duration: 150 }}>
        <div class="logo">
          <svg width="44" height="44" viewBox="0 0 32 32" aria-hidden="true">
            <rect x="2" y="2" width="28" height="28" rx="7" fill="#2563eb" />
            <path d="M9 16.6l5.1 5.1L23.7 11" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </div>
        <h1>歡迎使用 Deskdo</h1>
        <p class="lead">只要設定一次，待辦就能在電腦和手機之間同步；想要的話，也能讓 Claude、ChatGPT 等 AI 助理幫你管理。</p>
        <ul class="points">
          <li><Icon name="sparkle" size={15} /><span>待辦存在<b>你自己的 Cloudflare 帳號</b>，Deskdo 和開發者都看不到你的資料。</span></li>
          <li><Icon name="done" size={15} /><span>Cloudflare 免費方案就夠用，不需要綁信用卡。</span></li>
          <li><Icon name="refresh" size={15} /><span>接下來大約 2 分鐘：登入 Cloudflare，Deskdo 會自動完成所有設定。</span></li>
        </ul>
        <div class="row">
          <button class="primary big" onclick={() => (page = "connect")}>開始設定</button>
        </div>
      </section>
    {:else if page === "connect"}
      <section in:fade={{ duration: 150 }}>
        <p class="kicker">{mode === "new" ? "步驟 1／2" : "更新雲端"}</p>
        <h1>連接 Cloudflare</h1>
        <p class="lead">
          {mode === "new"
            ? "Deskdo 會在你的帳號建立一個小程式和資料庫，用來存放待辦。"
            : `將雲端更新到版本 ${store.prefs?.latestCloudVersion}。請登入目前使用的那個 Cloudflare 帳號。`}
        </p>

        {#if oauth}
          {#if waitingBrowser}
            <div class="waiting" in:fade>
              <span class="spinner"></span>
              <div>
                <div>請在瀏覽器完成登入並按「允許」</div>
                <div class="hint">完成後會自動回到這裡</div>
              </div>
              <button class="ghost" onclick={cancelLogin}>取消</button>
            </div>
          {:else}
            <div class="row">
              <button class="primary big" onclick={loginWithCloudflare} disabled={busy}>使用 Cloudflare 登入</button>
            </div>
          {/if}
          {#if mode === "new"}
            <p class="hint">還沒有帳號？<button class="link" onclick={() => openUrl(CF_SIGNUP)}>免費註冊 Cloudflare</button>，註冊完再回來按登入。</p>
          {/if}
        {/if}

        {#if !oauth || showToken}
          <div class="token-box" in:fade>
            <ol>
              {#if !oauth && mode === "new"}
                <li>還沒有 Cloudflare 帳號的話，先<button class="link" onclick={() => openUrl(CF_SIGNUP)}>免費註冊</button>。</li>
              {/if}
              <li><button class="link" onclick={() => openUrl(CF_TOKEN_TEMPLATE)}>開啟 API token 建立頁面</button>，權限已經幫你填好，拉到最下面按「繼續」→「建立 Token」。</li>
              <li>複製畫面上的 token，貼在下面。</li>
            </ol>
            <form class="token-row" onsubmit={(e) => (e.preventDefault(), connectToken())}>
              <input type="password" bind:value={token} placeholder="貼上 API token" spellcheck="false" autocomplete="off" aria-label="API token" />
              <button type="submit" class="primary" disabled={busy || !token.trim()}>{busy ? "連接中…" : "連接"}</button>
            </form>
          </div>
        {:else if oauth}
          <button class="link alt" onclick={() => (showToken = true)}>改用 API token</button>
        {/if}

        {#if error}<p class="error">{error}</p>{/if}
        {#if oncancel}
          <div class="row end"><button class="ghost" onclick={oncancel}>稍後再說</button></div>
        {/if}
      </section>
    {:else if page === "account"}
      <section in:fade={{ duration: 150 }}>
        <p class="kicker">{mode === "new" ? "步驟 2／2" : "更新雲端"}</p>
        <h1>{inspection ? "確認設定" : "選擇帳號"}</h1>

        {#if accounts.length > 1}
          <div class="accounts" role="radiogroup" aria-label="Cloudflare 帳號">
            {#each accounts as a (a.id)}
              <button class="account" class:on={account?.id === a.id} role="radio" aria-checked={account?.id === a.id} onclick={() => chooseAccount(a)} disabled={busy}>
                <span class="dot"></span>{a.name}
              </button>
            {/each}
          </div>
        {/if}

        {#if inspection && account}
          {#if inspection.mode === "update"}
            <p class="lead">將更新 <b>{inspection.script}</b> 到版本 {store.prefs?.latestCloudVersion}，資料不會變動。</p>
          {:else if inspection.existing}
            <p class="lead">這個帳號已經有 Deskdo 雲端（可能是另一台電腦設定的），會把{mobile ? "這支手機" : "這台電腦"}加入，資料不會變動。</p>
          {/if}

          {#if !inspection.subdomain}
            <label class="sub-field">
              <span>幫你的雲端網址取個名字</span>
              <span class="sub-input">
                <span class="affix">{inspection.script}.</span>
                <input bind:value={subdomain} spellcheck="false" aria-label="workers.dev 子網域" />
                <span class="affix">.workers.dev</span>
              </span>
              <span class="hint">只能用英文小寫、數字和連字號。這是整個 Cloudflare 帳號共用的名稱，之後不方便更改。</span>
            </label>
          {/if}

          <div class="row">
            <button class="primary big" onclick={deploy} disabled={busy || (!inspection.subdomain && !subdomainValid)}>
              {inspection.mode === "update" ? "開始更新" : "開始設定"}
            </button>
          </div>
        {/if}
        {#if error}<p class="error">{error}</p>{/if}
      </section>
    {:else if page === "deploy"}
      <section in:fade={{ duration: 150 }}>
        <h1>{mode === "new" ? "正在設定你的雲端" : "正在更新雲端"}</h1>
        <p class="lead">大約需要 1 分鐘，請不要關閉 Deskdo。</p>
        <ol class="steps">
          {#each visibleSteps as s (s.id)}
            {@const p = progress[s.id]}
            <li class={p?.state ?? "pending"}>
              <span class="mark">
                {#if p?.state === "running"}<span class="spinner small"></span>
                {:else if p?.state === "done"}<Icon name="done" size={16} />
                {:else if p?.state === "error"}<Icon name="close" size={14} />
                {:else}<span class="ring"></span>{/if}
              </span>
              <span class="label">{s.label}</span>
              {#if p?.detail}<span class="detail">{p.detail}</span>{/if}
            </li>
          {/each}
        </ol>
        {#if error}
          <p class="error">{error}</p>
          <div class="row">
            <button class="primary" onclick={deploy}>重試</button>
            <button class="ghost" onclick={() => ((page = "connect"), (error = ""))}>重新登入</button>
          </div>
        {/if}
      </section>
    {:else if page === "done" && result}
      <section in:fade={{ duration: 150 }}>
        {#if mode === "update"}
          <h1>雲端已更新</h1>
          <p class="lead">已更新到版本 {store.prefs?.latestCloudVersion}。</p>
          <div class="row"><button class="primary big" onclick={onfinish}>完成</button></div>
        {:else}
          <h1>設定完成 🎉</h1>
          <p class="lead">
            {mobile ? "可以開始使用了，也可以在主畫面加上 Deskdo 小工具。" : "桌面小工具已經可以使用了。"}
            {#if !result.reachable}新網址還在生效中，可能要再等一兩分鐘才會開始同步。{/if}
          </p>

          {#if result.connectorUrl}
            <h2>連接 AI 助理（可略過）</h2>
            <p class="hint">想用說的新增、查詢待辦，可以把 Deskdo 接到 AI 助理。不用的話直接按「開始使用」，之後也能在「設定」裡找到這個網址。</p>
            <div class="url-box">
              <code>{result.connectorUrl}</code>
              <button class="ghost" onclick={copy}>{copied ? "已複製" : "複製網址"}</button>
            </div>
            <span class="hint warn">這個網址等同密碼，請不要分享給別人。</span>

            <div class="tabs" role="tablist" aria-label="AI 助理">
              {#each AI_TABS as t (t.id)}
                <button role="tab" class:on={ai === t.id} aria-selected={ai === t.id} onclick={() => (ai = t.id)}>{t.label}</button>
              {/each}
            </div>
            {#if ai === "claude"}
              <ol class="ai-steps">
                <li><button class="link" onclick={() => openUrl(CLAUDE_CONNECTORS)}>開啟 claude.ai 的連接器設定</button>，選「新增自訂連接器」。</li>
                <li>名稱填「待辦清單」，網址貼上剛才複製的內容，按「新增」。</li>
                <li>完成。手機版 Claude 會自動同步，也可以搭配排程任務每天從 Gmail 整理待辦。</li>
              </ol>
            {:else if ai === "chatgpt"}
              <ol class="ai-steps">
                <li>在 ChatGPT 的設定裡開啟「開發者模式」（在「應用程式與連接器」→「進階」）。</li>
                <li>建立連接器：名稱填「待辦清單」，網址貼上剛才複製的內容，驗證方式選「不需要驗證」。</li>
                <li>在對話中選用這個連接器。ChatGPT 每次新增或修改待辦前會先請你確認。</li>
              </ol>
              <p class="hint">
                新增、修改待辦需要 ChatGPT 支援可寫入的連接器，部分方案可能只能查詢。選單名稱可能變動，請以
                <button class="link" onclick={() => openUrl(CHATGPT_MCP_HELP)}>OpenAI 的說明</button>為準。
              </p>
            {:else}
              <p class="hint ai-other">
                任何支援遠端 MCP 伺服器（Streamable HTTP）的工具都可以使用這個網址，例如 Cursor、VS Code，驗證方式選「無」。
                <button class="link" onclick={() => openUrl(SITE_GUIDE + "#ai")}>查看使用說明</button>
              </p>
            {/if}
          {/if}
          <div class="row"><button class="primary big" onclick={onfinish}>開始使用</button></div>
        {/if}
      </section>
    {/if}
  </div>
</div>

<style>
  .setup {
    height: 100%;
    overflow: auto;
    display: grid;
    /* 欄寬固定是視窗寬度；不然會被不換行的網址撐開，手機上整頁比螢幕寬 */
    grid-template-columns: minmax(0, 1fr);
    place-items: center;
    padding: 32px 24px;
  }
  .panel {
    width: min(560px, 100%);
    min-width: 0;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .logo {
    margin-bottom: 4px;
  }
  h1 {
    font-size: 26px;
    font-weight: 700;
    margin: 0;
  }
  h2 {
    font-size: 15px;
    margin: 10px 0 0;
  }
  .kicker {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--accent);
  }
  .lead {
    margin: 0;
    font-size: 14px;
    line-height: 1.7;
    color: var(--sub);
  }
  .points {
    list-style: none;
    padding: 0;
    margin: 6px 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .points li {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    line-height: 1.6;
    font-size: 13.5px;
  }
  .points li :global(svg) {
    flex: none;
    margin-top: 3px;
    color: var(--accent);
  }
  .row {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-top: 6px;
  }
  .row.end {
    justify-content: flex-end;
  }
  .hint {
    font-size: 12.5px;
    color: var(--faint);
    margin: 0;
    line-height: 1.6;
  }
  .hint.warn {
    color: var(--warn);
  }
  .link.alt {
    align-self: flex-start;
    font-size: 12.5px;
  }
  .error {
    margin: 0;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--warn-soft);
    color: var(--warn);
    font-size: 13px;
    line-height: 1.6;
    user-select: text;
  }
  .waiting {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 16px;
    border-radius: 10px;
    background: var(--raised);
    border: 1px solid var(--line);
    font-size: 13.5px;
  }
  .waiting > div {
    flex: 1;
  }
  .token-box {
    padding: 14px 16px;
    border-radius: 10px;
    background: var(--raised);
    border: 1px solid var(--line);
  }
  .token-box ol {
    margin: 0 0 12px;
    padding-left: 20px;
    font-size: 13px;
    line-height: 1.8;
    color: var(--sub);
  }
  .token-row,
  .url-box {
    display: flex;
    gap: 8px;
  }
  .token-row input {
    flex: 1;
    min-width: 0;
    height: 34px;
    padding: 0 10px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--bg2);
    outline: none;
    font-size: 13px;
  }
  .token-row input:focus,
  .sub-input:focus-within {
    border-color: var(--accent);
  }
  .accounts {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .account {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--raised);
    text-align: left;
    font-size: 13.5px;
  }
  .account .dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1.5px solid var(--ring);
    flex: none;
  }
  .account.on {
    border-color: var(--accent);
  }
  .account.on .dot {
    border: 4px solid var(--accent);
  }
  .sub-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
  }
  .sub-input {
    display: flex;
    align-items: center;
    height: 36px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--bg2);
    overflow: hidden;
  }
  .sub-input input {
    flex: 1;
    min-width: 60px;
    height: 100%;
    border: 0;
    background: var(--raised);
    padding: 0 8px;
    outline: none;
    font-size: 13px;
  }
  .affix {
    padding: 0 8px;
    color: var(--faint);
    font-size: 12.5px;
    white-space: nowrap;
  }
  .steps {
    list-style: none;
    margin: 4px 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .steps li {
    display: grid;
    grid-template-columns: 22px auto 1fr;
    align-items: center;
    gap: 10px;
    padding: 7px 0;
    font-size: 13.5px;
  }
  .steps li.pending {
    color: var(--faint);
  }
  .steps li.done .mark {
    color: var(--ok);
  }
  .steps li.error .mark {
    color: var(--warn);
  }
  .steps li.skip .mark {
    color: var(--faint);
  }
  .mark {
    display: grid;
    place-items: center;
  }
  .ring {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 1.5px solid var(--ring);
  }
  .detail {
    font-size: 12px;
    color: var(--faint);
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spinner {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 2px solid var(--accent-soft);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
    flex: none;
  }
  .spinner.small {
    width: 14px;
    height: 14px;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .ai-steps {
    margin: 0;
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 13.5px;
    line-height: 1.6;
  }
  .ai-other {
    font-size: 13.5px;
    color: var(--sub);
  }
  .tabs {
    display: flex;
    gap: 4px;
    padding: 3px;
    border-radius: 10px;
    background: var(--active);
    align-self: flex-start;
    margin-top: 4px;
  }
  .tabs button {
    height: 28px;
    padding: 0 14px;
    border-radius: 7px;
    font-size: 13px;
    color: var(--sub);
  }
  .tabs button.on {
    background: var(--raised);
    color: var(--text);
    font-weight: 600;
    box-shadow: var(--card-shadow);
  }
  .url-box {
    margin: 0;
    align-items: center;
  }
  .url-box code {
    flex: 1;
    min-width: 0;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--active);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: all;
  }
</style>
