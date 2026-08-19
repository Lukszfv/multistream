(function () {
  "use strict";

  window.MSH = window.MSH || {};

  // -----------------------------------------------------------------
  // QUALIDADE — aplicada via API oficial de cada player
  // -----------------------------------------------------------------
  // Twitch: Twitch.Player (SDK oficial) -> player.setQuality()
  // YouTube: postMessage (API oficial do iframe) -> setPlaybackQuality
  // Kick: não há API pública documentada para isso no player embutido.
  const YOUTUBE_QUALITY_LEVELS = {
    "1080p": "hd1080",
    "720p": "hd720",
    "480p": "large",
    "360p": "medium",
    "160p": "small",
  };

  const QUALITY_SUPPORT = { twitch: true, youtube: true, kick: false };

  function getQualitySupport(platform) {
    return !!QUALITY_SUPPORT[platform];
  }

  function warnUnsupportedQuality(stream) {
    console.warn(
      `[MultiStream] A plataforma "${stream.platform}" não expõe API oficial de qualidade ` +
      `para o player embutido. Ignorando qualidade padrão para "${stream.channel}".`
    );
  }

  // -----------------------------------------------------------------
  // TWITCH — SDK oficial (player.twitch.tv/js/embed/v1.js)
  // -----------------------------------------------------------------
  let twitchScriptPromise = null;
  function ensureTwitchScript() {
    if (window.Twitch && window.Twitch.Player) return Promise.resolve();
    if (twitchScriptPromise) return twitchScriptPromise;

    twitchScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://player.twitch.tv/js/embed/v1.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Falha ao carregar o SDK da Twitch."));
      document.head.appendChild(script);
    });
    return twitchScriptPromise;
  }

  // Instâncias vivas dos players — NÃO faz parte do estado sério da
  // aplicação (é só a "ponte" para chamar métodos oficiais do player).
  const twitchPlayers = new Map(); // streamId -> Twitch.Player

  async function mountTwitchPlayer(cardEl, stream) {
    const mountEl = cardEl.querySelector(`#twitch-mount-${stream.id}`);
    if (!mountEl) return;

    try {
      await ensureTwitchScript();
    } catch (err) {
      console.warn("[MultiStream]", err.message);
      return;
    }

    // O card pode ter sido removido enquanto o script carregava.
    if (!document.body.contains(mountEl)) return;
    // Evita criar duas instâncias para o mesmo card (ex.: chamadas concorrentes).
    if (twitchPlayers.has(stream.id)) return;

    const player = new window.Twitch.Player(mountEl.id, {
      channel: stream.channel,
      parent: [window.location.hostname],
      muted: stream.muted,
      autoplay: true,
      width: "100%",
      height: "100%",
    });

    twitchPlayers.set(stream.id, player);

    player.addEventListener(window.Twitch.Player.READY, () => {
      applyTwitchQuality(player, stream);
    });
  }

  function applyTwitchQuality(player, stream) {
    if (!stream.quality || stream.quality === "auto") return;
    try {
      const qualities = typeof player.getQualities === "function" ? player.getQualities() : [];
      const match = qualities.find((q) => q.group && q.group.startsWith(stream.quality));
      if (match) {
        player.setQuality(match.group);
      } else {
        console.warn(
          `[MultiStream] Qualidade "${stream.quality}" indisponível para "${stream.channel}" ` +
          `(Twitch); mantendo a automática.`
        );
      }
    } catch (err) {
      console.warn("[MultiStream] Não foi possível aplicar qualidade na Twitch:", err);
    }
  }

  // -----------------------------------------------------------------
  // YOUTUBE — API oficial via postMessage no próprio <iframe>
  // -----------------------------------------------------------------
  function postYouTubeCommand(iframe, func, args) {
    if (!iframe || !iframe.contentWindow) return;
    try {
      iframe.contentWindow.postMessage(
        JSON.stringify({ event: "command", func, args: args || [] }),
        "*"
      );
    } catch (err) {
      console.warn("[MultiStream] Falha ao enviar comando ao player do YouTube:", err);
    }
  }

  function buildYouTubeSrc(stream) {
    const params = new URLSearchParams();
    params.set("autoplay", "1");
    params.set("mute", stream.muted ? "1" : "0");
    params.set("enablejsapi", "1");
    params.set("origin", window.location.origin);
    return `${stream.embedUrl}?${params.toString()}`;
  }

  function mountYouTubePlayer(cardEl, stream) {
    const iframe = cardEl.querySelector(`#youtube-iframe-${stream.id}`);
    if (!iframe) return;

    const applyQuality = () => {
      if (!stream.quality || stream.quality === "auto") return;
      const level = YOUTUBE_QUALITY_LEVELS[stream.quality];
      if (!level) return;
      postYouTubeCommand(iframe, "setPlaybackQuality", [level]);
    };

    // O player interno do YouTube demora um instante para inicializar a
    // API mesmo depois do "load" do iframe — reforçamos o comando sem
    // nunca trocar o "src" (ou seja, sem recarregar o player).
    iframe.addEventListener("load", () => {
      applyQuality();
      setTimeout(applyQuality, 800);
      setTimeout(applyQuality, 2000);
    });
  }

  // -----------------------------------------------------------------
  // KICK — sem SDK oficial de qualidade; mantém <iframe> simples
  // -----------------------------------------------------------------
  function buildKickSrc(stream) {
    const params = new URLSearchParams();
    params.set("muted", stream.muted ? "true" : "false");
    params.set("autoplay", "true");
    return `${stream.embedUrl}?${params.toString()}`;
  }

  /** Mantido por compatibilidade com quem só precisa da URL (Kick/YouTube). */
  function buildEmbedUrl(stream) {
    if (stream.platform === "youtube") return buildYouTubeSrc(stream);
    if (stream.platform === "kick") return buildKickSrc(stream);
    return stream.embedUrl;
  }

  function platformBadgeClass(platform) {
    return `stream-card__platform-badge stream-card__platform-badge--${platform}`;
  }

  // -----------------------------------------------------------------
  // SHELL HTML (não instancia nenhum player ainda — isso é feito por
  // mountPlayer, chamado depois que o card já está no DOM real)
  // -----------------------------------------------------------------
  function renderPlayerBodyHTML(stream) {
    if (!stream.isLive) {
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

    if (stream.platform === "twitch") {
      return `<div class="stream-card__twitch-mount" data-role="twitch-mount" id="twitch-mount-${stream.id}"></div>`;
    }

    if (stream.platform === "youtube") {
      return `
        <iframe
          id="youtube-iframe-${stream.id}"
          data-role="youtube-iframe"
          src="${buildYouTubeSrc(stream)}"
          allow="autoplay; fullscreen"
          loading="lazy"
        ></iframe>
      `;
    }

    return `
      <iframe
        data-role="kick-iframe"
        src="${buildKickSrc(stream)}"
        allow="autoplay; fullscreen"
        loading="lazy"
      ></iframe>
    `;
  }

  /**
   * Instancia de fato o player (Twitch SDK / YouTube API / nada extra
   * para Kick) DEPOIS que o card já está anexado ao documento. Só deve
   * ser chamada para streams ao vivo recém-criadas ou recém-recarregadas
   * — nunca em reorganizações puramente visuais (foco, layout, ocultar).
   */
  async function mountPlayer(cardEl, stream) {
    if (!stream.isLive) return;

    if (stream.platform === "twitch") {
      await mountTwitchPlayer(cardEl, stream);
      return;
    }
    if (stream.platform === "youtube") {
      mountYouTubePlayer(cardEl, stream);
      return;
    }
    if (stream.quality && stream.quality !== "auto") {
      warnUnsupportedQuality(stream); // Kick
    }
  }

  /** Libera a instância viva de player associada a uma stream (Twitch). */
  function disposePlayer(streamId) {
    const player = twitchPlayers.get(streamId);
    if (player) {
      try {
        if (typeof player.pause === "function") player.pause();
      } catch (err) {
        // sem problema, o elemento já está sendo descartado
      }
      twitchPlayers.delete(streamId);
    }
  }

  // -----------------------------------------------------------------
  // MUTE / PAUSE / PLAY — sempre via API oficial quando existir, para
  // não precisar recarregar o player. Kick cai no fallback de iframe.
  // -----------------------------------------------------------------
  function applyMute(cardEl, stream) {
    if (!stream.isLive) return;

    if (stream.platform === "twitch") {
      const player = twitchPlayers.get(stream.id);
      if (player && typeof player.setMuted === "function") {
        try {
          player.setMuted(stream.muted);
          return;
        } catch (err) {
          console.warn("[MultiStream] Falha ao mutar via Twitch Player API:", err);
        }
      }
      return; // player ainda não montou; nasce com o mute correto ao montar
    }

    if (stream.platform === "youtube") {
      const iframe = cardEl.querySelector('[data-role="youtube-iframe"]');
      if (iframe) {
        postYouTubeCommand(iframe, stream.muted ? "mute" : "unMute");
        return;
      }
    }

    // Kick: não há comando de mute via postMessage documentado — o único
    // jeito é recarregar o iframe com o parâmetro atualizado.
    refreshPlayerBody(cardEl, stream);
    mountPlayer(cardEl, stream);
  }

  function applyPause(cardEl, stream) {
    if (!stream.isLive) return;
    if (stream.platform === "twitch") {
      const player = twitchPlayers.get(stream.id);
      if (player && typeof player.pause === "function") player.pause();
      return;
    }
    if (stream.platform === "youtube") {
      const iframe = cardEl.querySelector('[data-role="youtube-iframe"]');
      if (iframe) postYouTubeCommand(iframe, "pauseVideo");
      return;
    }
    console.warn(`[MultiStream] Pausar não é suportado pelo player do Kick ("${stream.channel}").`);
  }

  function applyPlay(cardEl, stream) {
    if (!stream.isLive) return;
    if (stream.platform === "twitch") {
      const player = twitchPlayers.get(stream.id);
      if (player && typeof player.play === "function") player.play();
      return;
    }
    if (stream.platform === "youtube") {
      const iframe = cardEl.querySelector('[data-role="youtube-iframe"]');
      if (iframe) postYouTubeCommand(iframe, "playVideo");
      return;
    }
    console.warn(`[MultiStream] Retomar não é suportado pelo player do Kick ("${stream.channel}").`);
  }

  // -----------------------------------------------------------------
  // CRIAÇÃO / ATUALIZAÇÃO DE CARDS
  // -----------------------------------------------------------------
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
          <span class="stream-card__quality-badge is-hidden" data-role="quality-badge" title="Qualidade não suportada pelo player desta plataforma">⚠</span>
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

    const qualityBadge = cardEl.querySelector('[data-role="quality-badge"]');
    if (qualityBadge) {
      const unsupported = !!stream.quality && stream.quality !== "auto" && !getQualitySupport(stream.platform);
      qualityBadge.classList.toggle("is-hidden", !unsupported);
    }
  }

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
   * Recria o conteúdo interno de `.stream-card__player` (usado só
   * quando é realmente necessário trocar de player: editar
   * plataforma/canal, refresh individual/geral, ou fallback de mute no
   * Kick). Descarta qualquer instância de player anterior deste card.
   */
  function refreshPlayerBody(cardEl, stream) {
    disposePlayer(stream.id);
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
      playerWrapper.requestFullscreen().catch(() => {});
    }
  }

  /**
   * Remove um card do DOM. Se o card não estiver visualmente renderizado
   * (ex.: está na gaveta de ocultos, com display:none), a animação de
   * saída não tocaria — nesse caso remove direto, sem esperar
   * "animationend" (que nunca dispararia).
   */
  function removeCardElement(cardEl, onDone) {
    const isRendered = cardEl.offsetParent !== null || getComputedStyle(cardEl).display !== "none";

    if (!isRendered) {
      cardEl.remove();
      if (typeof onDone === "function") onDone();
      return;
    }

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
    mountPlayer,
    disposePlayer,
    applyMute,
    applyPause,
    applyPlay,
  };
})();