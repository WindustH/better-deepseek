import { loadState, updateState, subscribeToState } from './storage';
import type { AppState, TogglePreferences } from './types';

export class ToggleGuard {
  private static instance: ToggleGuard;
  private prefs: TogglePreferences | undefined;
  private userActionUntil = 0;
  private observers: MutationObserver[] = [];

  private constructor() {
    this.init();
  }

  static getInstance() {
    if (!ToggleGuard.instance) {
      ToggleGuard.instance = new ToggleGuard();
    }
    return ToggleGuard.instance;
  }

  private async init() {
    try {
      const state = await loadState();
      this.prefs = state.togglePrefs;
    } catch {
      // storage unavailable
    }

    subscribeToState((state: AppState) => {
      this.prefs = state.togglePrefs;
    });

    this.waitForElements();
  }

  /** Smart search is always the 2nd .ds-toggle-button in the input area. */
  private findSearchToggle(): HTMLElement | null {
    const toggles = document.querySelectorAll<HTMLElement>('.ds-toggle-button[role="button"]');
    return toggles.length >= 2 ? toggles[1] : null;
  }

  private async waitForElements() {
    let searchToggle = this.findSearchToggle();

    if (!searchToggle) {
      await new Promise<void>(resolve => {
        const mo = new MutationObserver(() => {
          if (this.findSearchToggle()) { mo.disconnect(); resolve(); }
        });
        mo.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => { mo.disconnect(); resolve(); }, 30000);
      });
      searchToggle = this.findSearchToggle();
    }

    if (!searchToggle) return;

    // Restore once on init
    if (this.prefs) {
      this.restoreSmartSearch(searchToggle);
      this.restoreFastMode();
    }

    this.observeSearchToggle(searchToggle);
    this.observeRadios();
  }

  private restoreSmartSearch(el: HTMLElement) {
    if (!this.prefs) return;
    const current = el.classList.contains('ds-toggle-button--selected');
    if (current !== this.prefs.smartSearch) {
      this.userActionUntil = Date.now() + 500;
      el.click();
    }
  }

  private restoreFastMode() {
    if (!this.prefs) return;
    const target = this.prefs.fastMode ? 'default' : 'expert';
    const radio = document.querySelector<HTMLElement>(
      `[role="radio"][data-model-type="${target}"]`
    );
    if (!radio || radio.getAttribute('aria-checked') === 'true') return;
    this.userActionUntil = Date.now() + 500;
    radio.click();
  }

  private observeSearchToggle(el: HTMLElement) {
    // Click listener: mark timestamp so MutationObserver knows it's a user action
    el.addEventListener('click', () => {
      this.userActionUntil = Date.now() + 500;
      requestAnimationFrame(() => {
        if (!chrome.runtime?.id) return;
        const selected = el.classList.contains('ds-toggle-button--selected');
        this.savePref('smartSearch', selected);
      });
    });

    // MutationObserver: detect page auto-toggles and restore
    const mo = new MutationObserver(() => {
      if (Date.now() < this.userActionUntil || !this.prefs) return;
      const current = el.classList.contains('ds-toggle-button--selected');
      if (current !== this.prefs.smartSearch) {
        this.userActionUntil = Date.now() + 500;
        el.click();
      }
    });
    mo.observe(el, { attributes: true, attributeFilter: ['class'] });
    this.observers.push(mo);
  }

  private observeRadios() {
    const radioGroup = document.querySelector('[role="radiogroup"]');
    if (!radioGroup) return;

    // Observe the radiogroup container (survives child re-renders via subtree)
    const mo = new MutationObserver(() => {
      if (Date.now() < this.userActionUntil || !this.prefs) return;
      const fastRadio = radioGroup.querySelector('[data-model-type="default"]');
      if (!fastRadio) return;
      const isFast = fastRadio.getAttribute('aria-checked') === 'true';
      if (isFast !== this.prefs.fastMode) {
        this.savePref('fastMode', isFast);
      }
    });
    mo.observe(radioGroup, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-checked'],
    });
    this.observers.push(mo);
  }

  private savePref<K extends keyof TogglePreferences>(key: K, value: TogglePreferences[K]) {
    updateState(s => {
      if (!s.togglePrefs) {
        s.togglePrefs = { smartSearch: true, fastMode: true };
      }
      s.togglePrefs[key] = value;
      return s;
    });
  }
}
