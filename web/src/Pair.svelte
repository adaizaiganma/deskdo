<script lang="ts">
  import { invoke } from "@deskdo/core/backend";
  import { t } from "@deskdo/core/i18n.svelte";

  const ua = navigator.userAgent;
  /** iPadOS 的 Safari 自稱是 Mac，用觸控點數分辨 */
  const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const iOS = /iPhone|iPod/.test(ua) || iPad;
  const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  /**
   * iPhone、iPad 加到主畫面的網頁和 Safari 不共用 cookie：在 Safari 配對的，從主畫面打開還是沒配對。
   * 所以先教使用者加到主畫面，從那裡打開再配對；也可以選擇直接在 Safari 用。
   */
  let inSafari = $state(false);
  const showGuide = $derived(iOS && !standalone && !inSafari);

  let code = $state("");
  let busy = $state(false);
  let error = $state("");
  const valid = $derived(/^\d{6}$/.test(code.replace(/\s/g, "")));

  function deviceName(): string {
    const kind = /iPhone|iPod/.test(ua) ? "iPhone" : iPad ? "iPad" : /Android/.test(ua) ? "Android" : /Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "";
    if (!kind) return t("網頁版", "Web");
    return t(`${kind}（網頁版）`, `${kind} (web)`);
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    busy = true;
    error = "";
    try {
      // 成功後 configured 變成 true，App.svelte 會換成待辦清單
      await invoke("web_pair", { code: code.replace(/\s/g, ""), name: deviceName() });
    } catch (err) {
      error = String(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="pair">
  <img class="logo" src="/app/icon-192.png" alt="" width="72" height="72" />
  <h1>Deskdo</h1>

  {#if showGuide}
    <p class="lead">{t("先把 Deskdo 加到主畫面，用起來就像 App：", "Add Deskdo to your home screen first so it works like an app:")}</p>
    <ol class="steps">
      <li>{t("點 Safari 下方（iPad 在上方）的分享按鈕", "Tap the Share button at the bottom of Safari (top on iPad)")}</li>
      <li>{t("選「加入主畫面」，再按「新增」", "Choose Add to Home Screen, then Add")}</li>
      <li>{t("從主畫面打開 Deskdo，在那裡輸入配對碼", "Open Deskdo from your home screen and enter the pairing code there")}</li>
    </ol>
    <p class="hint">{t("在 Safari 裡配對的，從主畫面打開時還要再配對一次，所以請在主畫面打開後再配對。", "Pairing in Safari doesn't carry over to the home screen app, so pair after opening it from the home screen.")}</p>
    <button class="link" onclick={() => (inSafari = true)}>{t("我要直接在 Safari 裡用", "Use it in Safari instead")}</button>
  {:else}
    <p class="lead">{t("輸入電腦版或 Android 版產生的配對碼，這個瀏覽器就能讀寫你的待辦。", "Enter the pairing code from the desktop or Android app to use your to-dos in this browser.")}</p>
    <form onsubmit={submit}>
      <input
        class="code"
        bind:value={code}
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="7"
        placeholder="000000"
        aria-label={t("配對碼", "Pairing code")}
      />
      <button type="submit" class="primary" disabled={!valid || busy}>{busy ? t("配對中…", "Pairing…") : t("配對", "Pair")}</button>
    </form>
    {#if error}<p class="error">{error}</p>{/if}
    <p class="hint">
      {t("配對碼在電腦版或 Android 版的「設定 → 在 iPhone、iPad 使用」產生，5 分鐘內有效。配對一次之後就不用再輸入。", "Make a code in the desktop or Android app under Settings → Use on iPhone or iPad. It's valid for 5 minutes, and you only need to pair once.")}
    </p>
  {/if}
</div>

<style>
  .pair {
    max-width: 420px;
    margin: 0 auto;
    padding: 48px 24px calc(32px + var(--nav-inset));
    height: 100%;
    overflow-y: auto;
    text-align: center;
    background: var(--bg);
  }
  .logo {
    display: block;
    margin: 0 auto 12px;
  }
  h1 {
    margin: 0 0 16px;
    font-size: 26px;
    font-weight: 700;
  }
  .lead {
    margin: 0 0 20px;
    line-height: 1.6;
  }
  .steps {
    text-align: left;
    margin: 0 0 16px;
    padding: 16px 16px 16px 36px;
    border-radius: 20px;
    background: var(--c);
    line-height: 1.7;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .code {
    height: 64px;
    border: 0;
    border-radius: 16px;
    background: var(--c-highest);
    outline: none;
    text-align: center;
    font-size: 32px;
    letter-spacing: 0.3em;
    font-variant-numeric: tabular-nums;
  }
  .code:focus {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .primary {
    height: 48px;
  }
  .error {
    margin: 12px 0 0;
    color: var(--warn);
  }
  .hint {
    margin: 20px 0 12px;
    font-size: 13px;
    color: var(--sub);
    line-height: 1.6;
  }
</style>
