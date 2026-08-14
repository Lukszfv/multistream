(function () {
  "use strict";

  window.MSH = window.MSH || {};

  const QUALITY_SUPPORT = {
    twitch: { supported: false },
    kick: { supported: false },
    youtube: { supported: "best-effort" },
  };

  const YOUTUBE_VQ_MAP = {
    "1080p": "hd1080",
    "720p": "hd720",
    "480p": "large",
    "360p": "medium",
    "160p": "tiny",
  };

  function getQualitySupport(platform) {
    return QUALITY_SUPPORT[platform] || { supported: false };
  }

  /**
   * Monta a URL de embed definitiva de um player, incluindo os
   * parâmetros específicos de cada plataforma (mute, parent, autoplay,
   * qualidade quando aplicável).
   *
   * @param {Object} stream - { platform, channel, embedUrl, muted, quality }
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
        if (stream.quality && stream.quality !== "auto" && YOUTUBE_VQ_MAP[stream.quality]) {
          params.set("vq", YOUTUBE_VQ_MAP[stream.quality]);
        }
        return `${stream.embedUrl}?${params.toString()}`;

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

  function renderPlayerBodyHTML(stream) {
    if (stream.isLive) {
      return `
        <iframe
          src="${buildEmbedUrl(stream)}"
          allowfullscreen
          allow="autoplay; fullscreen"
          loading="lazy"
        ></iframe>
      `;
    }

    const icon = stream.found === false ? "❓" : "💤";
    const message = stream.statusMessage || "Este canal não está ao vivo.";

    return `
      <div class="stream-card__status">
        <span class="stream-card__status-icon">${icon}</span>
        <span class="stream-card__status-message">${message}</span>
        <button class="btn btn--sm" data-action="retry">Verificar novamente</button>
      </div>
    `;
  }

  /**
   * Cria o elemento DOM completo de um card de live.
   * O ID único da stream (ex.: "player-1") fica em `card.dataset.id`
   * e nunca muda durante o ciclo de vida do card.
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
          <span class="${platformBadgeClass(stream.platform)}" data-role="badge"></span>
          <span class="stream-card__channel" data-role="channel-name" title="${stream.channel}">${stream.channel}</span>
        </div>
        <div class="stream-card__controls">
          <button class="btn btn--icon" data-action="focus" title="Foco">⭐</button>
          <button class="btn btn--icon" data-action="pin" title="Fixar">📌</button>
          <button class="btn btn--icon" data-action="mute" title="Mutar/Desmutar">🔇</button>
          <button class="btn btn--icon" data-action="chat" title="Mostrar/Esconder Chat">💬</button>
          <button class="btn btn--icon" data-action="edit" title="Editar">✏️</button>
          <button class="btn btn--icon" data-action="fullscreen" title="Tela cheia">⛶</button>
          <button class="btn btn--icon btn--danger" data-action="remove" title="Remover">✕</button>
        </div>
      </header>

      <div class="stream-card__player" data-role="player">
        ${renderPlayerBodyHTML(stream)}
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

  /**
   * Sincroniza classes/ícones visuais do card (pinado, focado, mutado)
   * com o estado atual do objeto stream. Não toca no <iframe> — pode
   * ser chamado livremente sem causar reload de player.
   */
  function applyStateClasses(cardEl, stream) {
    cardEl.classList.toggle("is-pinned", !!stream.pinned);
    cardEl.classList.toggle("is-focused-active", !!stream.focused);

    const muteBtn = cardEl.querySelector('[data-action="mute"]');
    if (muteBtn) {
      muteBtn.textContent = stream.muted ? "🔇" : "🔊";
      muteBtn.classList.toggle("is-active", stream.muted);
    }

    const pinBtn = cardEl.querySelector('[data-action="pin"]');
    if (pinBtn) pinBtn.classList.toggle("is-active", !!stream.pinned);

    const focusBtn = cardEl.querySelector('[data-action="focus"]');
    if (focusBtn) focusBtn.classList.toggle("is-active", !!stream.focused);
  }

  /**
   * Atualiza apenas o texto do nome do canal e o badge de plataforma
   * DESTE card (usado após edição) — nenhum outro card é tocado.
   */
  function updateCardHeader(cardEl, stream) {
    const nameEl = cardEl.querySelector('[data-role="channel-name"]');
    if (nameEl) {
      nameEl.textContent = stream.channel;
      nameEl.title = stream.channel;
    }
    const badgeEl = cardEl.querySelector('[data-role="badge"]');
    if (badgeEl) badgeEl.className = platformBadgeClass(stream.platform);
  }

  /**
   * Recria SOMENTE o conteúdo interno de `.stream-card__player` deste
   * card (iframe ou mensagem de status) — usado ao editar a stream,
   * alternar mute, ou pedir para verificar novamente. Nenhum outro
   * card no DOM é tocado, então nenhum outro player recarrega.
   */
  function refreshPlayerBody(cardEl, stream) {
    const playerWrapper = cardEl.querySelector('[data-role="player"]');
    if (playerWrapper) {
      playerWrapper.innerHTML = renderPlayerBodyHTML(stream);
    }
  }

  function toggleChatPanel(cardEl) {
    const panel = cardEl.querySelector(".stream-card__chat-panel");
    if (panel) panel.classList.toggle("is-open");
  }

  function requestFullscreen(cardEl) {
    const playerWrapper = cardEl.querySelector(".stream-card__player");
    if (playerWrapper && playerWrapper.requestFullscreen) {
      playerWrapper.requestFullscreen().catch(() => {
      });
    }
  }

  /**
   * Remove um card do DOM com animação de saída. Não afeta nenhum
   * outro card — o restante do grid se reorganiza automaticamente via
   * CSS Grid, sem precisar recriar nada.
   *
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
    updateCardHeader,
    refreshPlayerBody,
    toggleChatPanel,
    requestFullscreen,
    removeCardElement,
    getQualitySupport,
  };
})();