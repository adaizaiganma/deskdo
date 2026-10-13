<script lang="ts">
  import { LANG_OPTIONS, i18n, t } from "@deskdo/core/i18n.svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { onMount } from "svelte";
  import { CLAUDE_CONNECTORS, SITE_GUIDE } from "@deskdo/core/links";
  import { localDate, monthDay } from "@deskdo/core/dates";
  import { SAYING_CATEGORIES, sayingPrefs } from "@deskdo/core/saying.svelte";
  import { store } from "@deskdo/core/store.svelte";
  import type { Connector, Device, UpdateInfo } from "@deskdo/core/types";

  /** 開啟設定精靈（new：第一次設定；update：更新雲端） */
  let { onsetup }: { onsetup: (mode: "new" | "update") => void } = $props();

  const p = $derived(store.prefs);

  let apiBase = $state(store.prefs?.apiBase ?? "");
  let apiToken = $state(store.prefs?.apiToken ?? "");
  let pollSeconds = $state(store.prefs?.pollSeconds ?? 30);
  let showToken = $state(false);
  let testing = $state(false);
  let result = $state<{ ok: boolean; text: string } | null>(null);

  let connector = $state<Connector | null>(null);
  let connectorError = $state("");
  let confirmRotate = $state(false);
  let copied = $state(false);

  let devices = $state<Device[] | null>(null);
  let devicesError = $state("");
  let confirmRevoke = $state<string | null>(null);

  onMount(() => {
    if (store.prefs?.configured) loadDevices();
  });

  async function saveConnection(e: SubmitEvent) {
    e.preventDefault();
    testing = true;
    result = null;
    try {
      const n = await invoke<number>("save_connection", { apiBase, apiToken, pollSeconds: Number(pollSeconds) || 30 });
      result = { ok: true, text: t(`已儲存，連線成功，目前有 ${n} 項待辦`, `Saved. Connected, ${n} to-dos right now`) };
    } catch (err) {
      result = { ok: false, text: t(`已儲存，但連線失敗：${err}`, `Saved, but the connection failed: ${err}`) };
    } finally {
      testing = false;
    }
  }

  let updateStatus = $state("");

  async function checkUpdate() {
    updateStatus = t("正在檢查…", "Checking…");
    try {
      const found = await invoke<UpdateInfo | null>("check_update");
      if (found) store.appUpdate = found;
      updateStatus = found ? "" : t("已是最新版本", "You're up to date");
    } catch (e) {
      updateStatus = String(e);
    }
  }

  async function showConnector() {
    connectorError = "";
    try {
      connector = await invoke<Connector>("get_connector");
    } catch (e) {
      connectorError = String(e);
    }
  }

  async function rotateConnector() {
    confirmRotate = false;
    connectorError = "";
    try {
      connector = await invoke<Connector>("rotate_connector");
    } catch (e) {
      connectorError = String(e);
    }
  }

  async function copyConnector() {
    if (!connector) return;
    await navigator.clipboard.writeText(connector.url);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  async function loadDevices() {
    devicesError = "";
    try {
      devices = await invoke<Device[]>("list_devices");
    } catch (e) {
      devicesError = String(e);
    }
  }

  async function revoke(id: string) {
    confirmRevoke = null;
    try {
      await invoke("revoke_device", { id });
      await loadDevices();
    } catch (e) {
      devicesError = String(e);
    }
  }

  function seen(iso: string | null): string {
    if (!iso) return t("尚未連線", "Never connected");
    const d = new Date(iso);
    const day = localDate(iso);
    if (!day) return "";
    const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    if (i18n.en) return day === store.today ? `Used today at ${time}` : `Used ${monthDay(day, store.today)}`;
    return day === store.today ? `今天 ${time} 使用過` : `${monthDay(day, store.today)} 使用過`;
  }
</script>

<div class="settings">

  {#if p && !p.configured}
    <section class="card callout">
      <div>
        <h2>{t("還沒有完成設定", "Not set up yet")}</h2>
        <p class="hint">{t("登入 Cloudflare，Deskdo 會自動建立你的雲端，大約 2 分鐘。", "Sign in to Cloudflare and Deskdo sets up your cloud for you. It takes about 2 minutes.")}</p>
      </div>
      <button class="primary" onclick={() => onsetup("new")}>{t("開始設定", "Start setup")}</button>
    </section>
  {/if}

  {#if p?.configured}
    <section class="card">
      <h2>{t("AI 連接器（MCP）", "AI connector (MCP)")}</h2>
      <p class="hint">
        {t("想讓 Claude、ChatGPT 等 AI 助理讀寫你的待辦，就在它們的「自訂連接器」貼上這個網址；不用 AI 的話可以略過。網址等同密碼，請不要分享。", "To let AI assistants like Claude or ChatGPT read and edit your to-dos, paste this URL into their custom connector settings. Skip this if you don't use AI. Treat the URL like a password and don't share it.")}
      </p>
      {#if connector}
        <div class="url-box">
          <code>{connector.url}</code>
          <button class="ghost" onclick={copyConnector}>{copied ? t("已複製", "Copied") : t("複製", "Copy")}</button>
        </div>
        <div class="btns">
          <button class="link" onclick={() => openUrl(CLAUDE_CONNECTORS)}>{t("Claude 連接器設定", "Claude connector settings")}</button>
          <button class="link" onclick={() => openUrl(SITE_GUIDE + "#ai")}>{t("其他 AI 的設定方式", "Setting up other AIs")}</button>
          <span class="grow"></span>
          {#if connector.rotatable}
            {#if confirmRotate}
              <span class="hint">{t("舊網址會立即失效，AI 助理那邊要換成新網址", "The old URL stops working right away; update it in your AI assistant")}</span>
              <button class="ghost danger" onclick={rotateConnector}>{t("確定更換", "Replace")}</button>
              <button class="ghost" onclick={() => (confirmRotate = false)}>{t("取消", "Cancel")}</button>
            {:else}
              <button class="ghost" onclick={() => (confirmRotate = true)}>{t("更換網址", "New URL")}</button>
            {/if}
          {/if}
        </div>
      {:else}
        <div class="btns"><button class="ghost" onclick={showConnector}>{t("顯示網址", "Show URL")}</button></div>
      {/if}
      {#if connectorError}<p class="result bad">{connectorError}</p>{/if}
    </section>

    <section class="card">
      <h2>{t("已連線的裝置", "Connected devices")}</h2>
      {#if devices}
        {#each devices as d (d.id)}
          <div class="toggle-row">
            <div>
              <div>{d.name}{#if d.current}<span class="tag">{t("這支手機", "This phone")}</span>{/if}</div>
              <div class="hint">{seen(d.lastSeenAt)}{t("・", " · ")}{t(`${monthDay(localDate(d.createdAt) ?? store.today, store.today)} 加入`, `Added ${monthDay(localDate(d.createdAt) ?? store.today, store.today)}`)}</div>
            </div>
            {#if !d.current}
              {#if confirmRevoke === d.id}
                <span class="btns">
                  <button class="ghost danger" onclick={() => revoke(d.id)}>{t("確定移除", "Remove")}</button>
                  <button class="ghost" onclick={() => (confirmRevoke = null)}>{t("取消", "Cancel")}</button>
                </span>
              {:else}
                <button class="ghost" onclick={() => (confirmRevoke = d.id)}>{t("移除", "Remove")}</button>
              {/if}
            {/if}
          </div>
        {:else}
          <p class="hint">{t("這個雲端是用舊版的方式（setup.ps1）部署的，沒有個別的電腦紀錄。", "This cloud was deployed the old way (setup.ps1), so there's no per-device record.")}</p>
        {/each}
        <p class="hint">{t("要在另一台電腦或手機使用：安裝 Deskdo，用同一個 Cloudflare 帳號登入即可。移除後，那台裝置就不能再讀寫待辦。", "To use another PC or phone, install Deskdo and sign in with the same Cloudflare account. A removed device can no longer read or edit your to-dos.")}</p>
      {/if}
      {#if devicesError}<p class="result bad">{devicesError}</p>{/if}
    </section>

    <section class="card">
      <h2>{t("雲端", "Cloud")}</h2>
      <div class="toggle-row">
        <div>
          <div>{t("雲端版本", "Cloud version")} {p.cloudVersion ?? "—"}</div>
          <div class="hint">
            {#if store.cloudOutdated}{t(`有新版本 ${p.latestCloudVersion}，更新需要登入 Cloudflare，資料不會變動`, `Version ${p.latestCloudVersion} is available. Updating needs a Cloudflare sign-in; your data stays as is`)}
            {:else if p.cloudVersion === null}{t("還沒連上雲端", "Not connected to the cloud yet")}
            {:else}{t("已是最新版本", "Up to date")}{/if}
          </div>
        </div>
        {#if store.cloudOutdated}<button class="primary" onclick={() => onsetup("update")}>{t("更新雲端", "Update cloud")}</button>{/if}
      </div>
    </section>
  {/if}

  <section class="card">
    <h2>{t("語言", "Language")}</h2>
    <p class="hint">{t("介面和主畫面小工具都會換成這個語言", "Used for the app and the home screen widget")}</p>
    <div class="chips" role="radiogroup" aria-label={t("語言", "Language")}>
      {#each LANG_OPTIONS as o (o.id)}
        <button class="pill" class:on={i18n.pref === o.id} role="radio" aria-checked={i18n.pref === o.id} onclick={() => i18n.set(o.id)}>{o.label()}</button>
      {/each}
    </div>
  </section>

  <section class="card">
    <h2>{t("每日一言", "Daily quote")}</h2>
    {#if i18n.en}
      <p class="hint">English quotes are built in. Switch the language to Chinese to pick quote types.</p>
    {:else}
    <p class="hint">要顯示哪些句子，可以選好幾種。換了之後主頁會抓一句新的。</p>
    <div class="chips" role="group" aria-label="每日一言的類型">
      {#each SAYING_CATEGORIES as c (c.id)}
        {@const on = sayingPrefs.categories.includes(c.id)}
        <button class="pill" class:on aria-pressed={on} onclick={() => sayingPrefs.toggle(c.id)}>{c.label}</button>
      {/each}
    </div>
    {/if}
  </section>

  {#if p}
    <section class="card">
      <h2>{t("主畫面小工具", "Home screen widget")}</h2>
      <p class="hint">{t("在手機主畫面長按空白處，選「小工具」，找到 Deskdo 拖到主畫面。小工具會列出待辦，點圓圈就能完成。", "Long-press an empty spot on your home screen, choose Widgets, and drag Deskdo onto it. The widget lists your to-dos; tap a circle to complete one.")}</p>
    </section>
  {/if}

  {#if p}
    <section class="card">
      <h2>{t("系統", "System")}</h2>
      <div class="toggle-row">
        <div>
          <div>{t("版本", "Version")} {p.appVersion}{#if p.beta}{t("（測試版）", " (beta)")}{/if}</div>
          <div class="hint">
            {#if store.appUpdate}{t(`新版 ${store.appUpdate.version} 可以下載了`, `Version ${store.appUpdate.version} is ready to download`)}
            {:else if p.beta}{t("測試版不會自動更新", "Beta builds don't update automatically")}
            {:else}{updateStatus || t("每 6 小時自動檢查一次，有新版會提醒你", "Checks every 6 hours and lets you know about new versions")}{/if}
          </div>
        </div>
        {#if store.appUpdate}
          <button class="primary" onclick={() => store.installUpdate()}>{t("下載新版", "Download update")}</button>
        {:else if !p.beta}
          <button class="ghost" onclick={checkUpdate} disabled={updateStatus === t("正在檢查…", "Checking…")}>{t("檢查更新", "Check for updates")}</button>
        {/if}
      </div>
    </section>
  {/if}

  <details class="card advanced">
    <summary>{t("進階：手動設定連線", "Advanced: manual connection")}</summary>
    <p class="hint">{t("給自己用 wrangler 部署 Worker 的開發者。一般使用者請用上面的設定精靈。", "For developers who deploy the Worker with wrangler themselves. Everyone else should use the setup wizard above.")}</p>
    <form onsubmit={saveConnection}>
      <label class="field">
        <span>{t("API 網址", "API URL")}</span>
        <input bind:value={apiBase} placeholder={t("https://deskdo.<子網域>.workers.dev", "https://deskdo.<subdomain>.workers.dev")} spellcheck="false" />
      </label>
      <label class="field">
        <span>API token</span>
        <span class="with-btn">
          <input type={showToken ? "text" : "password"} bind:value={apiToken} spellcheck="false" autocomplete="off" />
          <button type="button" class="ghost" onclick={() => (showToken = !showToken)}>{showToken ? t("隱藏", "Hide") : t("顯示", "Show")}</button>
        </span>
      </label>
      <label class="field">
        <span>{t("同步間隔", "Sync interval")}</span>
        <span class="with-unit"><input type="number" min="10" max="600" bind:value={pollSeconds} />{t("秒", "s")}</span>
      </label>
      <div class="actions">
        <button type="submit" class="primary" disabled={testing}>{testing ? t("連線中…", "Connecting…") : t("儲存並測試連線", "Save and test")}</button>
        {#if result}<span class="result" class:bad={!result.ok}>{result.text}</span>{/if}
      </div>
    </form>
  </details>
</div>

<style>
  .settings {
    padding: 4px 16px 32px;
  }
  h2 {
    font-size: 14px;
    font-weight: 700;
    color: var(--accent);
    margin: 0 0 12px;
  }
  .card {
    background: var(--c);
    border-radius: 20px;
    padding: 16px 18px;
    margin-bottom: 12px;
  }
  .field {
    display: grid;
    grid-template-columns: 84px 1fr;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
    font-size: 14px;
  }
  .field input,
  .with-unit input {
    width: 100%;
    height: 44px;
    padding: 0 12px;
    border-radius: 12px;
    border: 0;
    background: var(--c-highest);
    outline: none;
    font-size: 14px;
  }
  .field input:focus {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .with-btn {
    display: flex;
    gap: 8px;
  }
  .with-unit {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--sub);
  }
  .with-unit input {
    width: 90px;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 4px;
    flex-wrap: wrap;
  }
  .result {
    font-size: 12.5px;
    color: var(--ok);
  }
  .result.bad {
    color: var(--warn);
  }
  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 10px 0;
    font-size: 15px;
  }
  .toggle-row + .toggle-row {
    border-top: 1px solid var(--line);
  }
  .hint {
    font-size: 13px;
    color: var(--sub);
    margin-top: 2px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }
  .callout {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    background: var(--accent-container);
    color: var(--on-accent-container);
  }
  .callout h2 {
    color: var(--text);
    margin-bottom: 4px;
  }
  .card > .hint {
    margin: 0 0 12px;
    line-height: 1.6;
  }
  .url-box {
    display: flex;
    gap: 8px;
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
  .btns {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
  }
  .toggle-row .btns {
    margin-top: 0;
  }
  .grow {
    flex: 1;
  }
  .tag {
    margin-left: 8px;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 11px;
  }
  .advanced {
    padding: 4px 4px 0;
  }
  .advanced summary {
    min-height: 48px;
    display: flex;
    align-items: center;
    font-size: 14px;
    font-weight: 700;
    color: var(--sub);
    cursor: pointer;
  }
  .advanced[open] summary {
    margin-bottom: 10px;
  }
  .result {
    margin: 8px 0 0;
  }
  .actions .result {
    margin: 0;
  }
</style>
