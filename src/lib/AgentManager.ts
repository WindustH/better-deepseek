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
  private initPromise: Promise<void>;
  private urlPollTimer: ReturnType<typeof setInterval> | null = null;
  private tempSidebarMo: MutationObserver | null = null;

  private sidebarContainer: HTMLElement | null = null;
  private cachedLinks: HTMLElement[] = [];
  private cachedGroups = new Set<HTMLElement>();
  private filterDirty = true;

  private constructor() {
    this.initPromise = this.init();
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
    } catch {
      // loadState handles errors internally; fall back to defaults
      this.localState = { agents: [], sessions: {}, activeAgentId: null };
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

    // Fallback — DeepSeek's SPA sometimes navigates without touching history API.
    this.urlPollTimer = setInterval(() => {
      if (!chrome.runtime?.id) {
        if (this.urlPollTimer) { clearInterval(this.urlPollTimer); this.urlPollTimer = null; }
        return;
      }
      checkUrl();
    }, 1500);
  }

  private async handleUrlChange() {
    await this.initPromise;
    const isNewChat = location.pathname === '/';
    const match = location.pathname.match(/\/a\/chat\/s\/([a-zA-Z0-9-]+)/);
    const sessionId = match ? match[1] : null;

    if (isNewChat) {
      if (this.localState.activeAgentId) {
        const agent = this.localState.agents.find(a => a.id === this.localState.activeAgentId);
        if (agent) this.autoFillAndSend(agent);
      }
    } else if (sessionId && this.localState.activeAgentId) {
      if (this.localState.sessions[sessionId] !== this.localState.activeAgentId) {
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
    await this.initPromise;
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

    this.clearInputArea();

    const agent = this.localState.agents.find(a => a.id === agentId);
    if (agent) this.autoFillAndSend(agent);
  }

  public async deactivateAgent() {
    await this.initPromise;
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

  private getInputWrapper(textarea: HTMLElement): HTMLElement | null {
    let el: HTMLElement | null = textarea;
    for (let i = 0; el && i < 3; i++) el = el.parentElement;
    return el;
  }

  private getFileArea(wrapper: HTMLElement, textarea: HTMLElement): HTMLElement | null {
    const firstChild = wrapper.firstElementChild as HTMLElement | null;
    return (firstChild && !firstChild.contains(textarea)) ? firstChild : null;
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

    const wrapper = textarea ? this.getInputWrapper(textarea) : null;
    const fileArea = wrapper && textarea ? this.getFileArea(wrapper, textarea) : null;
    if (fileArea) {
      try {
        const closeButtons = fileArea.querySelectorAll<HTMLElement>(
          'button, [role="button"], [tabindex="0"]'
        );
        closeButtons.forEach(e => { try { e.click(); } catch { /* ignore */ } });
      } catch { /* DOM may have changed */ }
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

      const wrapper = this.getInputWrapper(textarea);
      const fileArea = wrapper ? this.getFileArea(wrapper, textarea) : null;

      for (const fileData of files) {
        if (fileArea?.textContent?.includes(fileData.name)) continue;
        const res = await fetch(fileData.dataURL);
        const blob = await res.blob();
        const file = new File([blob], fileData.name, { type: fileData.type });
        dataTransfer.items.add(file);
        addedFiles++;
      }

      if (addedFiles > 0) {
        const dropTarget = fileArea || wrapper || document.body;
        dropTarget.dispatchEvent(new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer
        }));
      }
    } catch (e) {
      console.error('Failed to attach files:', e);
    }
  }

  private async injectPrompt(textarea: HTMLTextAreaElement, agent: Agent) {
    const prompt = agent.prompt || '';
    if (!prompt) return;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    nativeSetter?.call(textarea, prompt);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
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
        if (this.filterDirty) this.scheduleFilterHistory();
      });
      this.sidebarObserver.observe(container, { childList: true, subtree: true });
    };

    const container = findContainer();
    if (container) {
      startObserving(container);
    } else {
      this.tempSidebarMo = new MutationObserver(() => {
        if (!chrome.runtime?.id) {
          this.tempSidebarMo?.disconnect();
          this.tempSidebarMo = null;
          return;
        }
        const c = findContainer();
        if (c) {
          this.tempSidebarMo?.disconnect();
          this.tempSidebarMo = null;
          startObserving(c);
          this.filterDirty = true;
          this.scheduleFilterHistory();
        }
      });
      this.tempSidebarMo.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { this.tempSidebarMo?.disconnect(); this.tempSidebarMo = null; }, 15000);
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

  public filterHistoryDOM() {
    const { activeAgentId, sessions } = this.localState;

    this.resolveCachedLinks();
    if (this.cachedLinks.length === 0) return;

    const allAgentSessionIds = new Set<string>();
    const currentAgentSessionIds = new Set<string>();
    for (const [sId, aId] of Object.entries(sessions)) {
      allAgentSessionIds.add(sId);
      if (aId === activeAgentId) currentAgentSessionIds.add(sId);
    }

    const groupVisibleCounts = new Map<HTMLElement, number>();

    for (const link of this.cachedLinks) {
      const sessionId = link.getAttribute('href')?.match(/\/a\/chat\/s\/([a-zA-Z0-9-]+)/)?.[1];
      if (!sessionId) continue;

      const shouldHide = activeAgentId
        ? !currentAgentSessionIds.has(sessionId)
        : allAgentSessionIds.has(sessionId);

      const currentlyHidden = link.style.display === 'none';
      if (shouldHide !== currentlyHidden) {
        link.style.display = shouldHide ? 'none' : '';
        link.classList.toggle('agent-hidden', shouldHide);
      }

      if (!shouldHide) {
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
