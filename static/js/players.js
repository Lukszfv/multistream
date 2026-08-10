(function () {
  "use strict";

  window.MSH = window.MSH || {};

  /**
   * Monta a URL de embed definitiva de um player, incluindo os
   * parâmetros específicos de cada plataforma (mute, parent, autoplay).
   *
   * @param {Object} stream - { platform, channel, embedUrl, muted }
   * @returns {string}
   */
  function buildEmbedUrl(stream) {
    const params = new URLSearchParams();

    switch (stream.platform) {
      case "twitch":
        params.set("parent", window.location.hostname || "localhost");
        params.set("muted", stream.muted ? "true" : "false");
        params.set("autoplay", "true");
        return `${stream.embedUrl}&${params.toString()}`;

      case "youtube":
        params.set("autoplay", "1");
        params.set("mute", stream.muted ? "1" : "0");
        return `${stream.embedUrl}&${params.toString()}`;

      case "kick":
        params.set("muted", stream.muted ? "true" : "false");
        params.set("autoplay", "true");
        return `${stream.embedUrl}?${params.toString()}`;

      default:
        return stream.embedUrl;
    }
  }

  function platformBadgeClass(platform) {
    return `stream-card__platform-badge stream-card__platform-badge--${platform}`;
  }

  /**
   * Cria o elemento DOM completo de um card de live.
   *
   * @param {Object} stream - objeto de estado da live (ver app.js)
   * @returns {HTMLElement}
   */
  function createCardElement(stream) {
    const card = document.createElement("article");
    card.className = "stream-card is-entering";
    card.dataset.id = stream.id;
    card.draggable = true;

    card.innerHTML = `
      <header class="stream-card__header">
        <div class="stream-card__info">
          <span class="${platformBadgeClass(stream.platform)}"></span>
          <span class="stream-card__channel" title="${stream.channel}">${stream.channel}</span>
        </div>
        <div class="stream-card__controls">
          <button class="btn btn--icon" data-action="focus" title="Foco">⭐</button>
          <button class="btn btn--icon" data-action="pin" title="Fixar">📌</button>
          <button class="btn btn--icon" data-action="mute" title="Mutar/Desmutar">🔇</button>
          <button class="btn btn--icon" data-action="chat" title="Mostrar/Esconder Chat">💬</button>
          <button class="btn btn--icon" data-action="fullscreen" title="Tela cheia">⛶</button>
          <button class="btn btn--icon btn--danger" data-action="remove" title="Remover">✕</button>
        </div>
      </header>

      <div class="stream-card__player">
        <iframe
          src="${buildEmbedUrl(stream)}"
          allowfullscreen
          allow="autoplay; fullscreen"
          loading="lazy"
        ></iframe>
      </div>

      <div class="stream-card__chat-panel">
        <div class="stream-card__chat-placeholder">
          Chat em breve — estrutura pronta para integração futura com
          ${stream.platform}.
        </div>
      </div>
    `;

    applyStateClasses(card, stream);
    return card;
  }

  function applyStateClasses(cardEl, stream) {
    cardEl.classList.toggle("is-pinned", !!stream.pinned);
    cardEl.classList.toggle("is-focused-active", !!stream.focused);

    const muteBtn = cardEl.querySelector('[data-action="mute"]');
    if (muteBtn) {
      muteBtn.textContent = stream.muted ? "🔇" : "🔊";
      muteBtn.classList.toggle("is-active", stream.muted);
    }

    const pinBtn = cardEl.querySelector('[data-action="pin"]');
    if (pinBtn) {
      pinBtn.classList.toggle("is-active", !!stream.pinned);
    }

    const focusBtn = cardEl.querySelector('[data-action="focus"]');
    if (focusBtn) {
      focusBtn.classList.toggle("is-active", !!stream.focused);
    }
  }

  function refreshPlayerSrc(cardEl, stream) {
    const iframe = cardEl.querySelector("iframe");
    if (iframe) {
      iframe.src = buildEmbedUrl(stream);
    }
  }

  function toggleChatPanel(cardEl) {
    const panel = cardEl.querySelector(".stream-card__chat-panel");
    if (panel) {
      panel.classList.toggle("is-open");
    }
  }

  function requestFullscreen(cardEl) {
    const playerWrapper = cardEl.querySelector(".stream-card__player");
    if (playerWrapper && playerWrapper.requestFullscreen) {
      playerWrapper.requestFullscreen().catch(() => {
      });
    }
  }

  /**
   * Remove um card do DOM com animação de saída.
   * @param {HTMLElement} cardEl
   * @param {Function} onDone - callback chamado após a animação
   */
  function removeCardElement(cardEl, onDone) {
    cardEl.classList.remove("is-entering");
    cardEl.classList.add("is-exiting");
    cardEl.addEventListener(
      "animationend",
      () => {
        cardEl.remove();
        if (typeof onDone === "function") onDone();
      },
      { once: true }
    );
  }

  window.MSH.players = {
    buildEmbedUrl,
    createCardElement,
    applyStateClasses,
    refreshPlayerSrc,
    toggleChatPanel,
    requestFullscreen,
    removeCardElement,
  };
})();