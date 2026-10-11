<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { onMount } from "svelte";
  import Clock from "../components/Clock.svelte";
  import { homePrefs, type ClockStyle } from "@deskdo/core/homePrefs.svelte";
  import { CLAUDE_CONNECTORS, SITE_GUIDE } from "@deskdo/core/links";
  import { localDate, monthDay } from "@deskdo/core/dates";
  import { store } from "@deskdo/core/store.svelte";
  import type { Connector, Device, UpdateInfo } from "@deskdo/core/types";

  const clockStyles: { id: ClockStyle; label: string }[] = [
    { id: "analog", label: "指針" },
    { id: "digital", label: "數位" },
  ];

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
      result = { ok: true, text: `已儲存，連線成功，目前有 ${n} 項待辦` };
    } catch (err) {
      result = { ok: false, text: `已儲存，但連線失敗：${err}` };
    } finally {
      testing = false;
    }
  }

  let updateStatus = $state("");

  async function checkUpdate() {
    updateStatus = "正在檢查…";
    try {
      const found = await invoke<UpdateInfo | null>("check_update");
      if (found) store.appUpdate = found;
      updateStatus = found ? "" : "已是最新版本";
    } catch (e) {
      updateStatus = String(e);
    }
  }

  async function setAutostart(on: boolean) {
    try {
      await invoke("set_autostart", { enabled: on });
    } catch (err) {
      result = { ok: false, text: String(err) };
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
    if (!iso) return "尚未連線";
    const d = new Date(iso);
    const day = localDate(iso);
    if (!day) return "";
    const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return day === store.today ? `今天 ${time} 使用過` : `${monthDay(day, store.today)} 使用過`;
  }
</script>

<div class="settings">
  <h1>設定</h1>

  {#if p && !p.configured}
    <section class="card callout">
      <div>
        <h2>還沒有完成設定</h2>
        <p class="hint">登入 Cloudflare，Deskdo 會自動建立你的雲端，大約 2 分鐘。</p>
      </div>
      <button class="primary" onclick={() => onsetup("new")}>開始設定</button>
    </section>
  {/if}

  {#if p?.configured}
    <section class="card">
      <h2>AI 連接器（MCP）</h2>
      <p class="hint">
        想讓 Claude、ChatGPT 等 AI 助理讀寫你的待辦，就在它們的「自訂連接器」貼上這個網址；不用 AI 的話可以略過。網址等同密碼，請不要分享。
      </p>
      {#if connector}
        <div class="url-box">
          <code>{connector.url}</code>
          <button class="ghost" onclick={copyConnector}>{copied ? "已複製" : "複製"}</button>
        </div>
        <div class="btns">
          <button class="link" onclick={() => openUrl(CLAUDE_CONNECTORS)}>Claude 連接器設定</button>
          <button class="link" onclick={() => openUrl(SITE_GUIDE + "#ai")}>其他 AI 的設定方式</button>
          <span class="grow"></span>
          {#if connector.rotatable}
            {#if confirmRotate}
              <span class="hint">舊網址會立即失效，AI 助理那邊要換成新網址</span>
              <button class="ghost danger" onclick={rotateConnector}>確定更換</button>
              <button class="ghost" onclick={() => (confirmRotate = false)}>取消</button>
            {:else}
              <button class="ghost" onclick={() => (confirmRotate = true)}>更換網址</button>
            {/if}
          {/if}
        </div>
      {:else}
        <div class="btns"><button class="ghost" onclick={showConnector}>顯示網址</button></div>
      {/if}
      {#if connectorError}<p class="result bad">{connectorError}</p>{/if}
    </section>

    <section class="card">
      <h2>已連線的裝置</h2>
      {#if devices}
        {#each devices as d (d.id)}
          <div class="toggle-row">
            <div>
              <div>{d.name}{#if d.current}<span class="tag">這台電腦</span>{/if}</div>
              <div class="hint">{seen(d.lastSeenAt)}・{monthDay(localDate(d.createdAt) ?? store.today, store.today)} 加入</div>
            </div>
            {#if !d.current}
              {#if confirmRevoke === d.id}
                <span class="btns">
                  <button class="ghost danger" onclick={() => revoke(d.id)}>確定移除</button>
                  <button class="ghost" onclick={() => (confirmRevoke = null)}>取消</button>
                </span>
              {:else}
                <button class="ghost" onclick={() => (confirmRevoke = d.id)}>移除</button>
              {/if}
            {/if}
          </div>
        {:else}
          <p class="hint">這個雲端是用舊版的方式（setup.ps1）部署的，沒有個別的電腦紀錄。</p>
        {/each}
        <p class="hint">要在另一台電腦或手機使用：安裝 Deskdo，用同一個 Cloudflare 帳號登入即可。移除後，那台裝置就不能再讀寫待辦。</p>
      {/if}
      {#if devicesError}<p class="result bad">{devicesError}</p>{/if}
    </section>

    <section class="card">
      <h2>雲端</h2>
      <div class="toggle-row">
        <div>
          <div>雲端版本 {p.cloudVersion ?? "—"}</div>
          <div class="hint">
            {#if store.cloudOutdated}有新版本 {p.latestCloudVersion}，更新需要登入 Cloudflare，資料不會變動
            {:else if p.cloudVersion === null}還沒連上雲端
            {:else}已是最新版本{/if}
          </div>
        </div>
        {#if store.cloudOutdated}<button class="primary" onclick={() => onsetup("update")}>更新雲端</button>{/if}
      </div>
    </section>
  {/if}

  <section class="card">
    <h2>主頁</h2>
    <div class="toggle-row">
      <div>
        <div>時鐘樣式</div>
        <div class="hint">顯示在主頁日期的右邊</div>
      </div>
      <div class="seg" role="radiogroup" aria-label="時鐘樣式">
        {#each clockStyles as c (c.id)}
          <button role="radio" aria-checked={homePrefs.clock === c.id} class:on={homePrefs.clock === c.id} onclick={() => homePrefs.setClock(c.id)}>{c.label}</button>
        {/each}
      </div>
    </div>
    <div class="clock-preview"><Clock size={104} mode={homePrefs.clock} /></div>
  </section>

  {#if p}
    <section class="card">
      <h2>桌面小工具</h2>
      <div class="toggle-row">
        <div>
          <div>顯示桌面小工具</div>
          <div class="hint">釘在桌面上、永遠在其他視窗下面</div>
        </div>
        <button
          class="switch"
          role="switch"
          aria-checked={p.showDesktopWidget}
          aria-label="顯示桌面小工具"
          onclick={() => invoke("set_widget_visible", { visible: !p.showDesktopWidget })}
        ><span></span></button>
      </div>
      <label class="toggle-row">
        <div>
          <div>毛玻璃濃度</div>
          <div class="hint">{Math.round(p.desktopOpacity * 100)}%・越低越看得到桌布</div>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={Math.round(p.desktopOpacity * 100)}
          oninput={(e) => invoke("set_widget_opacity", { opacity: Number(e.currentTarget.value) / 100 })}
        />
      </label>
    </section>

    <section class="card">
      <h2>系統</h2>
      <div class="toggle-row">
        <div>
          <div>開機時啟動</div>
          <div class="hint">登入 Windows 後自動在系統匣執行</div>
        </div>
        <button class="switch" role="switch" aria-checked={p.autostart} aria-label="開機時啟動" onclick={() => setAutostart(!p.autostart)}><span></span></button>
      </div>
      <div class="toggle-row">
        <div>
          <div>版本 {p.appVersion}{#if p.beta}（測試版）{/if}</div>
          <div class="hint">
            {#if store.appUpdate}新版 {store.appUpdate.version} 已經下載好
            {:else if p.beta}測試版不會自動更新
            {:else}{updateStatus || "每 6 小時自動檢查一次，有新版會在背景下載"}{/if}
          </div>
        </div>
        {#if store.appUpdate}
          <button class="primary" onclick={() => store.installUpdate()}>重新啟動並更新</button>
        {:else if !p.beta}
          <button class="ghost" onclick={checkUpdate} disabled={updateStatus === "正在檢查…"}>檢查更新</button>
        {/if}
      </div>
      <div class="toggle-row">
        <div>
          <div>結束程式</div>
          <div class="hint">關閉視窗只會收到系統匣；要完全結束請按這裡</div>
        </div>
        <button class="ghost" onclick={() => invoke("quit_app")}>結束</button>
      </div>
    </section>
  {/if}

  <details class="card advanced">
    <summary>進階：手動設定連線</summary>
    <p class="hint">給自己用 wrangler 部署 Worker 的開發者。一般使用者請用上面的設定精靈。</p>
    <form onsubmit={saveConnection}>
      <label class="field">
        <span>API 網址</span>
        <input bind:value={apiBase} placeholder="https://deskdo.<子網域>.workers.dev" spellcheck="false" />
      </label>
      <label class="field">
        <span>API token</span>
        <span class="with-btn">
          <input type={showToken ? "text" : "password"} bind:value={apiToken} spellcheck="false" autocomplete="off" />
          <button type="button" class="ghost" onclick={() => (showToken = !showToken)}>{showToken ? "隱藏" : "顯示"}</button>
        </span>
      </label>
      <label class="field">
        <span>同步間隔</span>
        <span class="with-unit"><input type="number" min="10" max="600" bind:value={pollSeconds} />秒</span>
      </label>
      <div class="actions">
        <button type="submit" class="primary" disabled={testing}>{testing ? "連線中…" : "儲存並測試連線"}</button>
        {#if result}<span class="result" class:bad={!result.ok}>{result.text}</span>{/if}
      </div>
    </form>
  </details>

  <p class="foot">設定檔位置：%APPDATA%\Deskdo\config.json</p>
</div>

<style>
  .settings {
    max-width: 640px;
    margin: 0 auto;
    padding: 28px 32px 40px;
  }
  h1 {
    font-size: 26px;
    font-weight: 700;
    margin: 0 0 20px;
  }
  h2 {
    font-size: 13px;
    font-weight: 700;
    color: var(--sub);
    margin: 0 0 12px;
  }
  .seg {
    flex: none;
    display: inline-flex;
    padding: 2px;
    border-radius: 9px;
    background: var(--bg2);
  }
  .seg button {
    height: 30px;
    padding: 0 16px;
    border-radius: 7px;
    font-size: 13px;
    color: var(--sub);
  }
  .seg button.on {
    background: var(--raised);
    color: var(--text);
    font-weight: 500;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  }
  .clock-preview {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 170px;
    margin-top: 6px;
    border-radius: 10px;
    background: var(--bg2);
  }
  .card {
    background: var(--raised);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 18px 20px;
    margin-bottom: 16px;
  }
  .field {
    display: grid;
    grid-template-columns: 96px 1fr;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
    font-size: 13px;
  }
  .field input,
  .with-unit input {
    width: 100%;
    height: 34px;
    padding: 0 10px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--bg2);
    outline: none;
    font-size: 13px;
  }
  .field input:focus {
    border-color: var(--accent);
    background: var(--raised);
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
    padding-left: 108px;
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
    font-size: 13.5px;
  }
  .toggle-row + .toggle-row {
    border-top: 1px solid var(--line);
  }
  .hint {
    font-size: 12px;
    color: var(--faint);
    margin-top: 2px;
  }
  .switch {
    flex: none;
    width: 40px;
    height: 22px;
    border-radius: 999px;
    background: var(--ring);
    position: relative;
    transition: background 0.2s;
  }
  .switch span {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.2s;
  }
  .switch[aria-checked="true"] {
    background: var(--accent);
  }
  .switch[aria-checked="true"] span {
    transform: translateX(18px);
  }
  input[type="range"] {
    width: 200px;
    accent-color: var(--accent);
  }
  .foot {
    font-size: 12px;
    color: var(--faint);
  }
  .callout {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    border-color: var(--accent);
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
  .advanced summary {
    font-size: 13px;
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
