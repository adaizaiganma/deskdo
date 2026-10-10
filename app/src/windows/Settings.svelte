<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { store } from "../lib/store.svelte";

  const p = $derived(store.prefs);

  let apiBase = $state(store.prefs?.apiBase ?? "");
  let apiToken = $state(store.prefs?.apiToken ?? "");
  let pollSeconds = $state(store.prefs?.pollSeconds ?? 30);
  let showToken = $state(false);
  let testing = $state(false);
  let result = $state<{ ok: boolean; text: string } | null>(null);

  async function saveConnection(e: SubmitEvent) {
    e.preventDefault();
    testing = true;
    result = null;
    try {
      const n = await invoke<number>("save_connection", { apiBase, apiToken, pollSeconds: Number(pollSeconds) || 30 });
      result = { ok: true, text: `已儲存，連線成功，伺服器上共有 ${n} 筆待辦` };
    } catch (err) {
      result = { ok: false, text: `已儲存，但連線失敗：${err}` };
    } finally {
      testing = false;
    }
  }

  async function setAutostart(on: boolean) {
    try {
      await invoke("set_autostart", { enabled: on });
    } catch (err) {
      result = { ok: false, text: String(err) };
    }
  }
</script>

<div class="settings">
  <h1>設定</h1>

  <form class="card" onsubmit={saveConnection}>
    <h2>連線</h2>
    <label class="field">
      <span>API 網址</span>
      <input bind:value={apiBase} placeholder="https://todo-worker.<帳號>.workers.dev" spellcheck="false" />
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
          <div>結束程式</div>
          <div class="hint">關閉視窗只會收到系統匣；要完全結束請按這裡</div>
        </div>
        <button class="ghost" onclick={() => invoke("quit_app")}>結束</button>
      </div>
    </section>
  {/if}

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
  .primary {
    height: 34px;
    padding: 0 16px;
    border-radius: 8px;
    background: var(--accent);
    color: #fff;
    font-size: 13px;
    font-weight: 500;
  }
  .primary:disabled {
    opacity: 0.6;
  }
  .ghost {
    height: 34px;
    padding: 0 14px;
    border-radius: 8px;
    background: var(--bg2);
    font-size: 13px;
    white-space: nowrap;
  }
  .ghost:hover {
    background: var(--active);
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
</style>
