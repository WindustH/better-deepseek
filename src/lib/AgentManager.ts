import { loadState, updateState, subscribeToState } from './storage';
import { waitForElement, waitForCondition } from './utils';
import type { Agent, AppState } from './types';

export class AgentManager {
  private static instance: AgentManager;
  private sidebarObserver: MutationObserver | null = null;
  private currentUrl = location.href;
  private localState: AppState = { agents: [], sessions: {}, activeAgentId: null };
  private filterRAF = 0;
  private isAutoFilling = false;

  private sidebarContainer: HTMLElement | null = null;
  private cachedLinks: HTMLElement[] = [];
  private cachedGroups = new Set<HTMLElement>();
  private filterDirty = true;

  private constructor() {
    this.init();
  }

  static getInstance() {
    if (!AgentManager.instance) {
      AgentManager.instance = new AgentManager();
    }
    return AgentManager.instance;
  }

  private async init() {
    try {
      this.localState = await loadState();
    } catch (e) {
      // Extension context invalidated — content script from a previous
      // extension version, nothing to do.
      console.log('[AgentManager] init failed, extension context likely invalidated');
      return;
    }
    subscribeToState((newState) => {
      this.localState = newState;
      this.filterDirty = true;
      this.scheduleFilterHistory();
    });
    this.interceptHistory();
    this.observeSidebar();
    this.handleUrlChange();
  }

  private interceptHistory() {
    const checkUrl = () => {
      if (this.currentUrl !== location.href) {
        this.currentUrl = location.href;
        this.handleUrlChange();
      }
    };

    window.addEventListener('popstate', checkUrl);

    const origPush = history.pushState.bind(history);
    history.pushState = (...args: Parameters<typeof history.pushState>) => {
      origPush(...args);
      checkUrl();
    };

    const origReplace = history.replaceState.bind(history);
    history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
      origReplace(...args);
      checkUrl();
    };

    // Poll for URL changes as a fallback — DeepSeek's SPA router sometimes
    // navigates without touching history.pushState/replaceState.
    const pollUrl = () => {
      if (this.currentUrl !== location.href) {
        this.currentUrl = location.href;
        this.handleUrlChange();
      }
    };
    setInterval(pollUrl, 250);
  }

  private async handleUrlChange() {
    const isNewChat = location.pathname === '/';
    const match = location.pathname.match(/\/a\/chat\/s\/([a-zA-Z0-9-]+)/);
    const sessionId = match ? match[1] : null;

    if (isNewChat) {
      if (this.localState.activeAgentId) {
        const agent = this.localState.agents.find(a => a.id === this.localState.activeAgentId);
        if (agent) {
          this.autoFillAndSend(agent);
        }
      }
    } else if (sessionId && this.localState.activeAgentId) {
      if (this.localState.sessions[sessionId] !== this.localState.activeAgentId) {
        // Update local state synchronously so filterHistoryDOM sees the new
        // session immediately — prevents a flash where all links are hidden.
        this.localState.sessions[sessionId] = this.localState.activeAgentId;
        this.filterDirty = true;
        this.scheduleFilterHistory();
        updateState(s => {
          s.sessions[sessionId] = this.localState.activeAgentId!;
          return s;
        });
        return;
      }
    }

    this.filterDirty = true;
    this.scheduleFilterHistory();
  }

  private clickNewChatOrRedirect() {
    if (location.pathname === '/') return;
    // Prefer clicking DeepSeek's own button so sidebar state is preserved.
    const newChatBtn = document.evaluate(
      '//div[contains(text(), "开启新对话") or contains(text(), "New chat")]',
      document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
    ).singleNodeValue as HTMLElement;
    if (newChatBtn) {
      newChatBtn.click();
    } else {
      history.pushState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }

  public async startAgentChat(agentId: string) {
    this.localState.activeAgentId = agentId;
    await updateState(s => {
      s.activeAgentId = agentId;
      const agent = s.agents.find(a => a.id === agentId);
      if (agent) agent.lastUsed = Date.now();
      return s;
    });

    if (location.pathname !== '/') {
      this.clickNewChatOrRedirect();
      return;
    }

    // Clear any stale state from a previous session, then wait for the DOM to
    // settle before auto-filling.
    this.clearInputArea();
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));

    const agent = this.localState.agents.find(a => a.id === agentId);
    if (agent) this.autoFillAndSend(agent);
  }

  public async deactivateAgent() {
    this.localState.activeAgentId = null;
    await updateState(s => {
      s.activeAgentId = null;
      return s;
    });

    this.clearInputArea();
    this.clickNewChatOrRedirect();
    this.filterDirty = true;
    this.scheduleFilterHistory();
  }

  private clearInputArea() {
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea');
    if (textarea) {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set;
      nativeSetter?.call(textarea, '');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Walk up 3 levels to the input wrapper.
    // The file area is the dynamic firstChild — only present when files exist.
    // When no files: firstChild is the input container (contains textarea).
    let el: HTMLElement | null = textarea ?? null;
    for (let i = 0; el && i < 3; i++) {
      el = el.parentElement;
    }
    const firstChild = el?.firstElementChild as HTMLElement | null;
    // Only target the file area (firstChild that does NOT contain the textarea)
    if (firstChild && textarea && !firstChild.contains(textarea)) {
      firstChild.querySelectorAll<HTMLElement>('[tabindex="0"]').forEach(e => e.click());
    }
  }

  private async autoFillAndSend(agent: Agent) {
    if (this.isAutoFilling) return;
    this.isAutoFilling = true;

    try {
      const textarea = await waitForElement<HTMLTextAreaElement>(
        '#chat-input, textarea',
        el => !el.disabled,
        10000
      );
      if (!textarea) return;

      if (agent.files && agent.files.length > 0) {
        await this.attachFiles(textarea, agent.files);
        await waitForCondition(() => !textarea.disabled, 5000);
      }

      await this.injectPrompt(textarea, agent);
    } finally {
      this.isAutoFilling = false;
    }
  }

  private async attachFiles(textarea: HTMLTextAreaElement, files: Agent['files']) {
    if (!files) return;
    try {
      const dataTransfer = new DataTransfer();
      let addedFiles = 0;

      // Walk up 3 levels to the input wrapper.
      let wrapper: HTMLElement | null = textarea;
      for (let i = 0; wrapper && i < 3; i++) {
        wrapper = wrapper.parentElement;
      }
      // The file area is the dynamic firstChild — only present when files exist.
      const firstChild = wrapper?.firstElementChild as HTMLElement | null;
      const fileArea = (firstChild && !firstChild.contains(textarea)) ? firstChild : null;
      const scopeText = fileArea?.textContent || '';

      for (const fileData of files) {
        if (scopeText.includes(fileData.name)) {
          console.log(`File ${fileData.name} seems already attached, skipping.`);
          continue;
        }
        const res = await fetch(fileData.dataURL);
        const blob = await res.blob();
        const file = new File([blob], fileData.name, { type: fileData.type });
        dataTransfer.items.add(file);
        addedFiles++;
      }

      if (addedFiles > 0) {
        // Drop on the file area if present, otherwise on the wrapper itself.
        const dropTarget = fileArea || wrapper || document.body;
        const dropEvent = new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dataTransfer
        });
        dropTarget.dispatchEvent(dropEvent);
      }
    } catch (e) {
      console.error('Failed to attach files:', e);
    }
  }

  private async injectPrompt(textarea: HTMLTextAreaElement, agent: Agent) {
    const finalPrompt = agent.prompt || '';

    if (finalPrompt) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      nativeInputValueSetter?.call(textarea, finalPrompt);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  private observeSidebar() {
    const findContainer = (): HTMLElement | null => {
      const link = document.querySelector('a[href*="/a/chat/s/"]');
      if (!link) return null;
      let el = link.parentElement;
      while (el && el !== document.body) {
        if (el.scrollHeight > el.clientHeight && el.querySelector('a[href*="/a/chat/s/"]')) {
          return el;
        }
        el = el.parentElement;
      }
      return link.closest('nav') || link.parentElement?.parentElement || null;
    };

    const startObserving = (container: HTMLElement) => {
      this.sidebarContainer = container;
      this.sidebarObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'childList' && m.addedNodes.length > 0) {
            this.filterDirty = true;
            break;
          }
        }
        if (this.filterDirty) {
          this.scheduleFilterHistory();
        }
      });
      this.sidebarObserver.observe(container, { childList: true, subtree: true });
    };

    const container = findContainer();
    if (container) {
      startObserving(container);
    } else {
      const tempMo = new MutationObserver(() => {
        const container = findContainer();
        if (container) {
          tempMo.disconnect();
          startObserving(container);
          this.filterDirty = true;
          this.scheduleFilterHistory();
        }
      });
      tempMo.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => tempMo.disconnect(), 15000);
    }
  }

  private scheduleFilterHistory() {
    if (this.filterRAF) return;
    this.filterRAF = requestAnimationFrame(() => {
      this.filterRAF = 0;
      this.filterHistoryDOM();
    });
  }

  private resolveCachedLinks() {
    if (!this.filterDirty) return;

    const scope = this.sidebarContainer || document.body;
    const links = scope.querySelectorAll('a[href*="/a/chat/s/"]');

    this.cachedLinks = [];
    this.cachedGroups.clear();

    for (const link of links) {
      this.cachedLinks.push(link as HTMLElement);

      const parent = link.parentElement;
      if (parent && parent.children.length > 1) {
        this.cachedGroups.add(parent);
      }
    }

    this.filterDirty = false;
  }

  /**
   * CSS-level filter as a safety net for edge cases the API interceptor misses
   * (e.g., sessions added after initial load, race conditions).
   * With the API interceptor active, this typically has very little to do.
   */
  public filterHistoryDOM() {
    const { activeAgentId, sessions } = this.localState;

    this.resolveCachedLinks();
    if (this.cachedLinks.length === 0) return;

    const allAgentSessionIds = new Set(Object.keys(sessions));
    const currentAgentSessionIds = new Set<string>();
    if (activeAgentId) {
      for (const [sId, aId] of Object.entries(sessions)) {
        if (aId === activeAgentId) currentAgentSessionIds.add(sId);
      }
    }

    const groupVisibleCounts = new Map<HTMLElement, number>();

    for (const link of this.cachedLinks) {
      const match = link.getAttribute('href')?.match(/\/a\/chat\/s\/([a-zA-Z0-9-]+)/);
      const sessionId = match?.[1];
      if (!sessionId) continue;

      const isVisible = activeAgentId
        ? currentAgentSessionIds.has(sessionId)
        : !allAgentSessionIds.has(sessionId);

      const isCurrentlyHidden = link.style.display === 'none';
      if (isVisible === isCurrentlyHidden) {
        link.style.display = isVisible ? '' : 'none';
        link.classList.toggle('agent-hidden', !isVisible);
      }

      if (isVisible) {
        const parent = link.parentElement;
        if (parent && this.cachedGroups.has(parent)) {
          groupVisibleCounts.set(parent, (groupVisibleCounts.get(parent) || 0) + 1);
        }
      }
    }

    for (const container of this.cachedGroups) {
      const visibleCount = groupVisibleCounts.get(container) || 0;
      const shouldHide = visibleCount === 0;
      if ((container.style.display === 'none') !== shouldHide) {
        container.style.display = shouldHide ? 'none' : '';
      }
    }
  }

}
