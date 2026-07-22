// ai-assistant.js
// Include this on chat.html AND contacts.html:
//   <link rel="stylesheet" href="ai-assistant.css">
//   <script src="config.js"></script>   (must define window.CONFIG.BACKEND_URL, or adjust below)
//   <script src="ai-assistant.js"></script>
//
// Expects (adjust to match your real app):
//   window.currentUserId          -> the logged-in user's id
//   window.sendMessage(text)      -> your existing function that sends a chat message
//                                    (falls back to filling the real input box if missing)

(function () {
  // This app exposes the backend URL as a plain global `BACKEND_URL`
  // (set in config.js) — not window.CONFIG.BACKEND_URL.
  const API_BASE = (typeof BACKEND_URL !== 'undefined' && BACKEND_URL) || '';

  // The app never sets window.currentUserId. Logged-in users are read via
  // window.AUTH.getUser(); guests fall back to the same kind of per-browser
  // id Chat.js already uses for guest usernames, so the rate limiter still
  // has something stable to key off of.
  function getUserId() {
    const user = window.AUTH ? window.AUTH.getUser() : null;
    if (user && (user.id || user._id)) return user.id || user._id;

    let guestId = localStorage.getItem('remix-nexusGuestAiId');
    if (!guestId) {
      guestId = 'guest-' + Math.random().toString(36).slice(2);
      localStorage.setItem('remix-nexusGuestAiId', guestId);
    }
    return guestId;
  }

  class AIAssistant {
    constructor() {
      this.panelOpen = false;
      this.mode = 'ask'; // 'ask' | 'draft'
      this.init();
    }

    init() {
      this.injectButton();
      this.injectPanel();
      this.bindEvents();
    }

    injectButton() {
      const btn = document.createElement('button');
      btn.id = 'ai-assist-btn';
      btn.className = 'ai-assist-fab';
      btn.innerHTML = '🤖';
      btn.setAttribute('aria-label', 'AI Assistant');
      document.body.appendChild(btn);
    }

    injectPanel() {
      const panel = document.createElement('div');
      panel.id = 'ai-assist-panel';
      panel.className = 'ai-assist-panel hidden';
      panel.innerHTML = `
        <div class="ai-assist-header">
          <div class="ai-assist-tabs">
            <button class="ai-tab active" data-mode="ask">Ask AI</button>
            <button class="ai-tab" data-mode="draft">Draft Reply</button>
          </div>
          <button id="ai-assist-close" aria-label="Close">✕</button>
        </div>
        <div id="ai-assist-body" class="ai-assist-body">
          <div id="ai-assist-messages" class="ai-assist-messages"></div>
        </div>
        <div class="ai-assist-input-row">
          <input id="ai-assist-input" type="text" placeholder="Ask anything..." />
          <button id="ai-assist-send">Send</button>
        </div>
      `;
      document.body.appendChild(panel);
    }

    bindEvents() {
      document.getElementById('ai-assist-btn').addEventListener('click', () => this.togglePanel());
      document.getElementById('ai-assist-close').addEventListener('click', () => this.togglePanel(false));
      document.getElementById('ai-assist-send').addEventListener('click', () => this.handleSend());
      document.getElementById('ai-assist-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.handleSend();
      });
      document.querySelectorAll('.ai-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
          document.querySelectorAll('.ai-tab').forEach(t => t.classList.remove('active'));
          e.target.classList.add('active');
          this.mode = e.target.dataset.mode;
          this.updatePlaceholder();
        });
      });
    }

    updatePlaceholder() {
      const input = document.getElementById('ai-assist-input');
      input.placeholder = this.mode === 'draft'
        ? 'Tap Send to generate reply options...'
        : 'Ask anything...';
    }

    togglePanel(force) {
      const panel = document.getElementById('ai-assist-panel');
      this.panelOpen = force !== undefined ? force : !this.panelOpen;
      panel.classList.toggle('hidden', !this.panelOpen);
    }

    // Chat.js's room messages (.msg-row) and Contacts.js's DM messages
    // (.msg) both stamp data-author / data-text on the message element,
    // so this works unchanged on either page.
    getRecentConversation(limit = 15) {
      const nodes = document.querySelectorAll('[data-author][data-text]');
      const messages = [];
      nodes.forEach(node => {
        const sender = node.dataset.author || 'user';
        const text = node.dataset.text || '';
        if (text) messages.push({ sender, text });
      });
      return messages.slice(-limit);
    }

    async handleSend() {
      const input = document.getElementById('ai-assist-input');
      const question = input.value.trim();
      if (this.mode === 'ask' && !question) return;

      this.addMessage('user', this.mode === 'draft' ? 'Generate reply options' : question);
      input.value = '';
      this.addMessage('ai', '...', true);

      try {
        const payload = {
          mode: this.mode,
          userId: getUserId(),
          question: this.mode === 'ask' ? question : undefined,
          conversation: this.mode === 'draft' ? this.getRecentConversation() : undefined,
        };

        const res = await fetch(`${API_BASE}/api/ai/assist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        this.removeLoading();

        if (data.error) {
          this.addMessage('ai', `Error: ${data.error}`);
          return;
        }

        if (this.mode === 'draft') {
          this.renderDraftOptions(data.options || []);
        } else {
          this.addMessage('ai', data.answer || 'No answer returned.');
        }
      } catch (err) {
        this.removeLoading();
        this.addMessage('ai', 'Something went wrong. Try again.');
        console.error(err);
      }
    }

    addMessage(role, text, loading = false) {
      const container = document.getElementById('ai-assist-messages');
      const el = document.createElement('div');
      el.className = `ai-msg ai-msg-${role}${loading ? ' loading' : ''}`;
      el.textContent = text;
      container.appendChild(el);
      container.scrollTop = container.scrollHeight;
    }

    removeLoading() {
      const loadingEl = document.querySelector('.ai-msg.loading');
      if (loadingEl) loadingEl.remove();
    }

    renderDraftOptions(options) {
      const container = document.getElementById('ai-assist-messages');
      const wrap = document.createElement('div');
      wrap.className = 'ai-draft-options';
      options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'ai-draft-option';
        btn.textContent = opt;
        btn.addEventListener('click', () => this.sendDraftReply(opt));
        wrap.appendChild(btn);
      });
      container.appendChild(wrap);
      container.scrollTop = container.scrollHeight;
    }

    sendDraftReply(text) {
      if (typeof window.sendMessage === 'function') {
        // Chat.html: Chat.js's top-level sendMessage() is globally reachable
        window.sendMessage(text);
        this.addMessage('ai', `Sent: "${text}"`);
        this.togglePanel(false);
        return;
      }

      // Contacts.html has no global sendMessage() — fill the real DM input
      // and submit its form so the draft actually sends, same as if the
      // user had typed it and hit Send.
      const chatInput = document.querySelector('#messageInput, #dmMessageInput');
      const form = chatInput ? chatInput.closest('form') : null;
      if (chatInput && form) {
        chatInput.value = text;
        if (form.requestSubmit) form.requestSubmit();
        else form.dispatchEvent(new Event('submit', { cancelable: true }));
        this.addMessage('ai', `Sent: "${text}"`);
      } else if (chatInput) {
        chatInput.value = text;
        chatInput.focus();
      }
      this.togglePanel(false);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    window.aiAssistant = new AIAssistant();
  });
})();