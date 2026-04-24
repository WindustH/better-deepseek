import { loadState, updateState, subscribeToState } from './storage';
import type { Agent, AppState } from './types';

const waitForElement = <T extends HTMLElement>(
  selector: string,
  predicate?: (el: T) => boolean,
  timeout = 10000
): Promise<T | null> => {
  const el = document.querySelector<T>(selector);
  if (el && (!predicate || predicate(el))) return Promise.resolve(el);

  return new Promise((resolve) => {
    const deadline = Date.now() + timeout;
    const mo = new MutationObserver(() => {
      const el = document.querySelector<T>(selector);
      if (el && (!predicate || predicate(el))) {
        mo.disconnect();
        resolve(el);
      } else if (Date.now() > deadline) {
        mo.disconnect();
        resolve(null);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  });
};

const waitForCondition = (
  fn: () => boolean,
  timeout = 10000
): Promise<boolean> => {
  if (fn()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const deadline = Date.now() + timeout;
    const check = () => {
      if (fn()) { resolve(true); return; }
      if (Date.now() > deadline) { resolve(false); return; }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
};

export class AgentManager {
  private static instance: AgentManager;
  private sidebarObserver: MutationObserver | null = null;
  private currentUrl = location.href;
  private localState: AppState = { agents: [], sessions: {}, activeAgentId: null };
  private filterRAF = 0;
  private isAutoFilling = false;

  // Cached references to avoid repeated DOM queries
  private sidebarContainer: HTMLElement | null = null;
  private cachedLinks: HTMLElement[] = [];
  private cachedGroups: HTMLElement[] = [];
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
    this.localState = await loadState();
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
        await updateState(s => {
          s.sessions[sessionId] = this.localState.activeAgentId!;
          return s;
        });
      }
    }

    this.filterDirty = true;
    this.scheduleFilterHistory();
  }

  private clickNewChatOrRedirect() {
    const newChatBtn = document.evaluate(
      '//div[contains(text(), "开启新对话") or contains(text(), "New chat")]',
      document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
    ).singleNodeValue as HTMLElement;

    if (newChatBtn) {
      newChatBtn.click();
    } else {
      location.href = '/';
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
    } else {
      const agent = this.localState.agents.find(a => a.id === agentId);
      if (agent) this.autoFillAndSend(agent);
    }
  }

  public async deactivateAgent() {
    this.localState.activeAgentId = null;
    await updateState(s => {
      s.activeAgentId = null;
      return s;
    });

    this.clickNewChatOrRedirect();
    this.filterDirty = true;
    this.scheduleFilterHistory();
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

      this.injectPrompt(textarea, agent);
    } finally {
      this.isAutoFilling = false;
    }
  }

  private async attachFiles(textarea: HTMLTextAreaElement, files: Agent['files']) {
    if (!files) return;
    try {
      const dataTransfer = new DataTransfer();
      let addedFiles = 0;

      const containerText = textarea.closest('div.flex')?.parentElement?.textContent || '';

      for (const fileData of files) {
        if (containerText.includes(fileData.name)) {
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
        const dropTarget = textarea.closest('div.flex') || document.body;
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

  private injectPrompt(textarea: HTMLTextAreaElement, agent: Agent) {
    const finalPrompt = agent.prompt || '';

    if (finalPrompt) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      nativeInputValueSetter?.call(textarea, finalPrompt);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    const tryClickSend = () => {
      const wrapper = textarea.closest('div:has(> div > textarea)');
      if (wrapper) {
        const btn = wrapper.querySelector('div[cursor="pointer"]:last-child') as HTMLElement;
        if (btn && !btn.hasAttribute('disabled')) { btn.click(); return true; }
      }
      const possibleBtn = document.querySelector('div.send-button, div[aria-label="Send message"]') as HTMLElement;
      if (possibleBtn && !possibleBtn.hasAttribute('disabled')) { possibleBtn.click(); return true; }
      return false;
    };

    if (!tryClickSend()) {
      waitForElement<HTMLElement>(
        'div[cursor="pointer"]:last-child, div.send-button, div[aria-label="Send message"]',
        el => !el.hasAttribute('disabled'),
        5000
      ).then(el => el?.click());
    }
  }

  /**
   * Find and observe only the sidebar history container.
   * This avoids reacting to DOM changes in the chat area (streaming, typing, etc.)
   */
  private observeSidebar() {
    // Try to find the sidebar container that holds history links
    const findContainer = (): HTMLElement | null => {
      // Walk up from any history link to find the scrollable sidebar root
      const link = document.querySelector('a[href*="/a/chat/s/"]');
      if (!link) return null;
      let el = link.parentElement;
      while (el && el !== document.body) {
        if (el.scrollHeight > el.clientHeight && el.querySelector('a[href*="/a/chat/s/"]')) {
          return el;
        }
        el = el.parentElement;
      }
      // Fallback: use the parent that contains all history links
      return link.closest('nav') || link.parentElement?.parentElement || null;
    };

    const startObserving = (container: HTMLElement) => {
      this.sidebarContainer = container;
      this.sidebarObserver = new MutationObserver((mutations) => {
        // Only care about structural changes to the history list
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
      // Sidebar not loaded yet — watch body briefly until we find it
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

    // Use sidebar container as scope to limit query range
    const scope = this.sidebarContainer || document.body;
    const links = scope.querySelectorAll('a[href*="/a/chat/s/"]');

    this.cachedLinks = [];
    this.cachedGroups = [];

    for (const link of links) {
      this.cachedLinks.push(link as HTMLElement);

      const parent = link.parentElement;
      if (parent && !this.cachedGroups.includes(parent) &&
        Array.from(parent.children).some(c => c.tagName === 'DIV')) {
        this.cachedGroups.push(parent);
      }
    }

    this.filterDirty = false;
  }

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

      // Only write DOM if state actually changed
      const isCurrentlyHidden = link.style.display === 'none';
      if (isVisible === isCurrentlyHidden) {
        link.style.display = isVisible ? '' : 'none';
        link.classList.toggle('agent-hidden', !isVisible);
      }

      if (isVisible) {
        const parent = link.parentElement;
        if (parent && this.cachedGroups.includes(parent)) {
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
