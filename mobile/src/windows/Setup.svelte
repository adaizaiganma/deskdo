<script lang="ts">
  import { t } from "@deskdo/core/i18n.svelte";
  import { invoke, listen } from "@deskdo/core/backend";
  import { openLink as openUrl } from "@deskdo/core/open";
  import { onMount, untrack } from "svelte";
  import { fade } from "svelte/transition";
  import Icon from "../components/Icon.svelte";
  import { CF_SIGNUP, CF_TOKEN_TEMPLATE, CHATGPT_MCP_HELP, CLAUDE_CONNECTORS, SITE_GUIDE } from "@deskdo/core/links";
  import { store } from "@deskdo/core/store.svelte";
  import type { Account, Inspection, SetupDone, SetupProgress, SetupStep } from "@deskdo/core/types";

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
    { id: "subdomain", get label() { return t("設定 workers.dev 網址", "Set up the workers.dev URL"); } },
    { id: "database", get label() { return t("準備資料庫", "Prepare the database"); } },
    { id: "migrate", get label() { return t("建立資料表", "Create tables"); } },
    { id: "device", get label() { return t("登記這支手機", "Register this phone"); } },
    { id: "upload", get label() { return t("上傳 Deskdo 雲端程式", "Upload the Deskdo cloud app"); } },
    { id: "route", get label() { return t("開啟網址", "Turn on the URL"); } },
    { id: "verify", get label() { return t("確認連線", "Check the connection"); } },
  ];
  let progress = $state<Partial<Record<SetupStep, SetupProgress>>>({});
  let result = $state<SetupDone | null>(null);
  let copied = $state(false);

  const AI_TABS = [
    { id: "claude", label: "Claude" },
    { id: "chatgpt", label: "ChatGPT" },
    { id: "other", get label() { return t("其他工具", "Other tools"); } },
  ] as const;
  let ai = $state<(typeof AI_TABS)[number]["id"]>("claude");

  const oauth = $derived(store.prefs?.oauthAvailable ?? false);
  const subdomainValid = $derived(/^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/.test(subdomain));
  const visibleSteps = $derived(STEPS.filter((s) => progress[s.id]?.state !== "skip" || s.id === "verify"));

  onMount(() => {
    const off = listen<SetupProgress>("setup-progress", (p) => {
      progress = { ...progress, [p.step]: p };
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
        <h1>{t("歡迎使用 Deskdo", "Welcome to Deskdo")}</h1>
        <p class="lead">{t("只要設定一次，待辦就能在電腦和手機之間同步；想要的話，也能讓 Claude、ChatGPT 等 AI 助理幫你管理。", "Set it up once and your to-dos sync between your PC and phone. If you like, AI assistants such as Claude or ChatGPT can manage them too.")}</p>
        <ul class="points">
          <li><Icon name="sparkle" size={15} /><span>{t("待辦存在", "Your to-dos live in ")}<b>{t("你自己的 Cloudflare 帳號", "your own Cloudflare account")}</b>{t("，Deskdo 和開發者都看不到你的資料。", ". Neither Deskdo nor its developer can see your data.")}</span></li>
          <li><Icon name="done" size={15} /><span>{t("Cloudflare 免費方案就夠用，不需要綁信用卡。", "The free Cloudflare plan is enough, no credit card needed.")}</span></li>
          <li><Icon name="refresh" size={15} /><span>{t("接下來大約 2 分鐘：登入 Cloudflare，Deskdo 會自動完成所有設定。", "About 2 minutes: sign in to Cloudflare and Deskdo does the rest.")}</span></li>
        </ul>
        <div class="row">
          <button class="primary big" onclick={() => (page = "connect")}>{t("開始設定", "Start setup")}</button>
        </div>
      </section>
    {:else if page === "connect"}
      <section in:fade={{ duration: 150 }}>
        <p class="kicker">{mode === "new" ? t("步驟 1／2", "Step 1 of 2") : t("更新雲端", "Update cloud")}</p>
        <h1>{t("連接 Cloudflare", "Connect Cloudflare")}</h1>
        <p class="lead">
          {mode === "new"
            ? t("Deskdo 會在你的帳號建立一個小程式和資料庫，用來存放待辦。", "Deskdo creates a small app and a database in your account to store your to-dos.")
            : t(`將雲端更新到版本 ${store.prefs?.latestCloudVersion}。請登入目前使用的那個 Cloudflare 帳號。`, `Updates your cloud to version ${store.prefs?.latestCloudVersion}. Sign in with the Cloudflare account it runs on.`)}
        </p>

        {#if oauth}
          {#if waitingBrowser}
            <div class="waiting" in:fade>
              <span class="spinner"></span>
              <div>
                <div>{t("請在瀏覽器完成登入並按「允許」", "Sign in in your browser and press Allow")}</div>
                <div class="hint">{t("完成後會自動回到這裡", "You'll come back here automatically")}</div>
              </div>
              <button class="ghost" onclick={cancelLogin}>{t("取消", "Cancel")}</button>
            </div>
          {:else}
            <div class="row">
              <button class="primary big" onclick={loginWithCloudflare} disabled={busy}>{t("使用 Cloudflare 登入", "Sign in with Cloudflare")}</button>
            </div>
          {/if}
          {#if mode === "new"}
            <p class="hint">{t("還沒有帳號？", "No account yet? ")}<button class="link" onclick={() => openUrl(CF_SIGNUP)}>{t("免費註冊 Cloudflare", "Sign up for Cloudflare for free")}</button>{t("，註冊完再回來按登入。", ", then come back and sign in.")}</p>
          {/if}
        {/if}

        {#if !oauth || showToken}
          <div class="token-box" in:fade>
            <ol>
              {#if !oauth && mode === "new"}
                <li>{t("還沒有 Cloudflare 帳號的話，先", "No Cloudflare account yet? ")}<button class="link" onclick={() => openUrl(CF_SIGNUP)}>{t("免費註冊", "Sign up for free")}</button>{t("。", " first.")}</li>
              {/if}
              <li><button class="link" onclick={() => openUrl(CF_TOKEN_TEMPLATE)}>{t("開啟 API token 建立頁面", "Open the API token page")}</button>{t("，權限已經幫你填好，拉到最下面按「繼續」→「建立 Token」。", ". The permissions are filled in; scroll down and press Continue → Create Token.")}</li>
              <li>{t("複製畫面上的 token，貼在下面。", "Copy the token and paste it below.")}</li>
            </ol>
            <form class="token-row" onsubmit={(e) => (e.preventDefault(), connectToken())}>
              <input type="password" bind:value={token} placeholder={t("貼上 API token", "Paste the API token")} spellcheck="false" autocomplete="off" aria-label="API token" />
              <button type="submit" class="primary" disabled={busy || !token.trim()}>{busy ? t("連接中…", "Connecting…") : t("連接", "Connect")}</button>
            </form>
          </div>
        {:else if oauth}
          <button class="link alt" onclick={() => (showToken = true)}>{t("改用 API token", "Use an API token instead")}</button>
        {/if}

        {#if error}<p class="error">{error}</p>{/if}
        {#if oncancel}
          <div class="row end"><button class="ghost" onclick={oncancel}>{t("稍後再說", "Maybe later")}</button></div>
        {/if}
      </section>
    {:else if page === "account"}
      <section in:fade={{ duration: 150 }}>
        <p class="kicker">{mode === "new" ? t("步驟 2／2", "Step 2 of 2") : t("更新雲端", "Update cloud")}</p>
        <h1>{inspection ? t("確認設定", "Confirm") : t("選擇帳號", "Choose an account")}</h1>

        {#if accounts.length > 1}
          <div class="accounts" role="radiogroup" aria-label={t("Cloudflare 帳號", "Cloudflare account")}>
            {#each accounts as a (a.id)}
              <button class="account" class:on={account?.id === a.id} role="radio" aria-checked={account?.id === a.id} onclick={() => chooseAccount(a)} disabled={busy}>
                <span class="dot"></span>{a.name}
              </button>
            {/each}
          </div>
        {/if}

        {#if inspection && account}
          {#if inspection.mode === "update"}
            <p class="lead">{t("將更新 ", "Updates ")}<b>{inspection.script}</b>{t(` 到版本 ${store.prefs?.latestCloudVersion}，資料不會變動。`, ` to version ${store.prefs?.latestCloudVersion}. Your data stays as is.`)}</p>
          {:else if inspection.existing}
            <p class="lead">{t("這個帳號已經有 Deskdo 雲端（可能是另一台電腦設定的），會把這支手機加入，資料不會變動。", "This account already has a Deskdo cloud (maybe set up on a PC). This phone will join it; your data stays as is.")}</p>
          {/if}

          {#if !inspection.subdomain}
            <label class="sub-field">
              <span>{t("幫你的雲端網址取個名字", "Name your cloud URL")}</span>
              <span class="sub-input">
                <span class="affix">{inspection.script}.</span>
                <input bind:value={subdomain} spellcheck="false" aria-label={t("workers.dev 子網域", "workers.dev subdomain")} />
                <span class="affix">.workers.dev</span>
              </span>
              <span class="hint">{t("只能用英文小寫、數字和連字號。這是整個 Cloudflare 帳號共用的名稱，之後不方便更改。", "Lowercase letters, numbers and hyphens only. The name is shared across your Cloudflare account and is hard to change later.")}</span>
            </label>
          {/if}

          <div class="row">
            <button class="primary big" onclick={deploy} disabled={busy || (!inspection.subdomain && !subdomainValid)}>
              {inspection.mode === "update" ? t("開始更新", "Start update") : t("開始設定", "Start setup")}
            </button>
          </div>
        {/if}
        {#if error}<p class="error">{error}</p>{/if}
      </section>
    {:else if page === "deploy"}
      <section in:fade={{ duration: 150 }}>
        <h1>{mode === "new" ? t("正在設定你的雲端", "Setting up your cloud") : t("正在更新雲端", "Updating your cloud")}</h1>
        <p class="lead">{t("大約需要 1 分鐘，請不要關閉 Deskdo。", "This takes about a minute. Please keep Deskdo open.")}</p>
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
            <button class="primary" onclick={deploy}>{t("重試", "Retry")}</button>
            <button class="ghost" onclick={() => ((page = "connect"), (error = ""))}>{t("重新登入", "Sign in again")}</button>
          </div>
        {/if}
      </section>
    {:else if page === "done" && result}
      <section in:fade={{ duration: 150 }}>
        {#if mode === "update"}
          <h1>{t("雲端已更新", "Cloud updated")}</h1>
          <p class="lead">{t(`已更新到版本 ${store.prefs?.latestCloudVersion}。`, `Updated to version ${store.prefs?.latestCloudVersion}.`)}</p>
          <div class="row"><button class="primary big" onclick={onfinish}>{t("完成", "Done")}</button></div>
        {:else}
          <h1>{t("設定完成 🎉", "All set 🎉")}</h1>
          <p class="lead">
            {t("可以開始使用了，也可以在主畫面加上 Deskdo 小工具。", "You're ready to go. You can also add the Deskdo widget to your home screen.")}
            {#if !result.reachable}{t("新網址還在生效中，可能要再等一兩分鐘才會開始同步。", "The new URL is still going live; syncing may start in a minute or two.")}{/if}
          </p>

          {#if result.connectorUrl}
            <h2>{t("連接 AI 助理（可略過）", "Connect an AI assistant (optional)")}</h2>
            <p class="hint">{t("想用說的新增、查詢待辦，可以把 Deskdo 接到 AI 助理。不用的話直接按「開始使用」，之後也能在「設定」裡找到這個網址。", "Connect Deskdo to an AI assistant to add and look up to-dos by just asking. If you don't need it, press Get started; the URL is also in Settings.")}</p>
            <div class="url-box">
              <code>{result.connectorUrl}</code>
              <button class="ghost" onclick={copy}>{copied ? t("已複製", "Copied") : t("複製網址", "Copy URL")}</button>
            </div>
            <span class="hint warn">{t("這個網址等同密碼，請不要分享給別人。", "Treat this URL like a password and don't share it.")}</span>

            <div class="tabs" role="tablist" aria-label={t("AI 助理", "AI assistant")}>
              {#each AI_TABS as tab (tab.id)}
                <button role="tab" class:on={ai === tab.id} aria-selected={ai === tab.id} onclick={() => (ai = tab.id)}>{tab.label}</button>
              {/each}
            </div>
            {#if ai === "claude"}
              <ol class="ai-steps">
                <li><button class="link" onclick={() => openUrl(CLAUDE_CONNECTORS)}>{t("開啟 claude.ai 的連接器設定", "Open the connector settings on claude.ai")}</button>{t("，選「新增自訂連接器」。", " and choose Add custom connector.")}</li>
                <li>{t("名稱填「待辦清單」，網址貼上剛才複製的內容，按「新增」。", "Name it \"To-do list\", paste the URL you copied and press Add.")}</li>
                <li>{t("完成。手機版 Claude 會自動同步，也可以搭配排程任務每天從 Gmail 整理待辦。", "Done. Claude on your phone picks it up too, and you can pair it with a scheduled task to collect to-dos from Gmail every day.")}</li>
              </ol>
            {:else if ai === "chatgpt"}
              <ol class="ai-steps">
                <li>{t("在 ChatGPT 的設定裡開啟「開發者模式」（在「應用程式與連接器」→「進階」）。", "Turn on Developer mode in ChatGPT's settings (Apps & Connectors → Advanced).")}</li>
                <li>{t("建立連接器：名稱填「待辦清單」，網址貼上剛才複製的內容，驗證方式選「不需要驗證」。", "Create a connector named \"To-do list\", paste the URL you copied and set authentication to No authentication.")}</li>
                <li>{t("在對話中選用這個連接器。ChatGPT 每次新增或修改待辦前會先請你確認。", "Pick the connector in a chat. ChatGPT asks you to confirm before adding or changing to-dos.")}</li>
              </ol>
              <p class="hint">
                {t("新增、修改待辦需要 ChatGPT 支援可寫入的連接器，部分方案可能只能查詢。選單名稱可能變動，請以", "Adding and changing to-dos needs a ChatGPT plan with write-capable connectors; some plans can only read. Menu names change, so check")}
                <button class="link" onclick={() => openUrl(CHATGPT_MCP_HELP)}>{t("OpenAI 的說明", "OpenAI's help page")}</button>{t("為準。", ".")}
              </p>
            {:else}
              <p class="hint ai-other">
                {t("任何支援遠端 MCP 伺服器（Streamable HTTP）的工具都可以使用這個網址，例如 Cursor、VS Code，驗證方式選「無」。", "Any tool that supports remote MCP servers (Streamable HTTP), such as Cursor or VS Code, can use this URL. Set authentication to none.")}
                <button class="link" onclick={() => openUrl(SITE_GUIDE + "#ai")}>{t("查看使用說明", "Read the guide")}</button>
              </p>
            {/if}
          {/if}
          <div class="row"><button class="primary big" onclick={onfinish}>{t("開始使用", "Get started")}</button></div>
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
