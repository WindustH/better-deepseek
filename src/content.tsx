import { createRoot } from 'react-dom/client';
import './index.css';
import { SidebarAgents } from './components/SidebarAgents';
import { AgentManager } from './lib/AgentManager';
import { ToggleGuard } from './lib/ToggleGuard';

AgentManager.getInstance();
ToggleGuard.getInstance();

const CONTAINER_ID = 'better-deepseek-agents-root';

function findSidebarAnchor(): { anchor: HTMLElement; parent: HTMLElement } | null {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeValue?.includes('开启新对话') || node.nodeValue?.includes('New chat')) {
      let container = node.parentElement;
      if (!container) continue;
      while (container.parentElement) {
        if (container.parentElement.querySelector('a[href*="/a/chat/s/"]')) {
          break;
        }
        container = container.parentElement;
      }
      if (container.parentElement) {
        return { anchor: container, parent: container.parentElement };
      }
    }
  }
  return null;
}

function injectSidebar(): boolean {
  if (document.getElementById(CONTAINER_ID)) return true;

  const result = findSidebarAnchor();
  if (!result) return false;

  const rootEl = document.createElement('div');
  rootEl.id = CONTAINER_ID;
  result.parent.insertBefore(rootEl, result.anchor.nextSibling);

  createRoot(rootEl).render(<SidebarAgents />);
  return true;
}

// Try once immediately, then watch only until injected
if (!injectSidebar()) {
  const mo = new MutationObserver(() => {
    if (injectSidebar()) {
      mo.disconnect();
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  // Safety net: stop trying after 30s regardless
  setTimeout(() => mo.disconnect(), 30000);
}
