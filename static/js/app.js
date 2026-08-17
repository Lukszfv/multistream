(function () {
  "use strict";

  const { api, players, layout, focus } = window.MSH;

  // -----------------------------------------------------------------
  // ESTADO GLOBAL
  // -----------------------------------------------------------------
  const state = {
    streams: [],
    settings: {
      theme: "dark",
      quality: "auto",
      autoMute: true,
      autoFocus: false,
      language: "pt-BR",
      autoSave: true,
    },
  };

  const SETTINGS_KEY = "msh:settings";
  const AUTOSAVE_LAYOUT_NAME = "__autosave__";

  // -----------------------------------------------------------------
  // GERENCIADOR DE PLAYERS
  // -----------------------------------------------------------------
  // `cardElements` mapeia o ID estável de cada stream (ex.: "player-1")
  // para o NÓ DOM real do seu card. Um card só é criado uma vez (ao
  // adicionar a stream) e só é destruído quando a stream é removida ou
  // quando uma ação EXPLÍCITA de troca de player acontece (editar
  // canal/plataforma, refresh individual, refresh geral). Foco, layout
  // salvo, ocultar/mostrar e arrastar NUNCA passam por aqui.
  const cardElements = new Map();

  // Cards recém-criados cujo player oficial (Twitch SDK / YouTube API)
  // ainda precisa ser instanciado — só pode acontecer depois que o nó
  // já está de fato inserido no documento.
  const pendingMounts = new Set();

  let idCounter = 0;
  function generateId() {
    idCounter += 1;
    return `player-${idCounter}`; // IDs nunca são reaproveitados
  }

  // -----------------------------------------------------------------
  // REFERÊNCIAS DE ELEMENTOS DOM
  // -----------------------------------------------------------------
  const el = {
    streamsArea: document.getElementById("streams-area"),
    emptyState: document.getElementById("empty-state"),
    streamsGrid: document.getElementById("streams-grid"),
    focusRow: document.getElementById("focus-row"),
    focusSecondaryRow: document.getElementById("focus-secondary-row"),
    hiddenStash: document.getElementById("hidden-stash"),

    addStreamPanel: document.getElementById("add-stream-panel"),
    addStreamForm: document.getElementById("add-stream-form"),
    platformSelect: document.getElementById("platform-select"),
    channelInput: document.getElementById("channel-input"),

    btnAddStream: document.getElementById("btn-add-stream"),
    btnMuteAll: document.getElementById("btn-mute-all"),
    btnSettings: document.getElementById("btn-settings"),
    btnTheme: document.getElementById("btn-theme"),
    btnCloseSettings: document.getElementById("btn-close-settings"),
    btnSaveCurrentLayout: document.getElementById("btn-save-current-layout"),

    sidebar: document.getElementById("settings-sidebar"),
    sidebarOverlay: document.getElementById("sidebar-overlay"),
    savedLayoutsList: document.getElementById("saved-layouts-list"),

    settingTheme: document.getElementById("setting-theme"),
    settingQuality: document.getElementById("setting-quality"),
    qualityNote: document.getElementById("quality-note"),
    settingAutoMute: document.getElementById("setting-auto-mute"),
    settingAutoFocus: document.getElementById("setting-auto-focus"),
    settingLanguage: document.getElementById("setting-language"),
    settingAutoSave: document.getElementById("setting-auto-save"),

    editModalOverlay: document.getElementById("edit-modal-overlay"),
    editStreamForm: document.getElementById("edit-stream-form"),
    editPlatformSelect: document.getElementById("edit-platform-select"),
    editChannelInput: document.getElementById("edit-channel-input"),
    btnCloseEditModal: document.getElementById("btn-close-edit-modal"),
    btnCancelEdit: document.getElementById("btn-cancel-edit"),

    // Menu "layouts salvos" (ícone de grade) — reorganiza, nunca recarrega
    btnLayoutMenu: document.getElementById("btn-layout-menu"),
    layoutMenuDropdown: document.getElementById("layout-menu-dropdown"),
    layoutMenuList: document.getElementById("layout-menu-list"),
    btnManageLayouts: document.getElementById("btn-manage-layouts"),

    // Painel "Gerenciar Streams"
    btnStreamList: document.getElementById("btn-stream-list"),
    streamListSidebar: document.getElementById("stream-list-sidebar"),
    streamListOverlay: document.getElementById("stream-list-overlay"),
    btnCloseStreamList: document.getElementById("btn-close-stream-list"),
    streamListItems: document.getElementById("stream-list-items"),
    btnPlayAllPaused: document.getElementById("btn-play-all-paused"),
    btnPauseAll: document.getElementById("btn-pause-all"),
    btnMuteAllPanel: document.getElementById("btn-mute-all-panel"),
    btnReloadAll: document.getElementById("btn-reload-all"),

    toast: document.getElementById("toast"),
  };

  // -----------------------------------------------------------------
  // TOAST
  // -----------------------------------------------------------------
  let toastTimeout = null;
  function showToast(message) {
    el.toast.textContent = message;
    el.toast.classList.add("is-visible");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      el.toast.classList.remove("is-visible");
    }, 2600);
  }

  // -----------------------------------------------------------------
  // CRIAÇÃO DE CARDS (uma única vez por stream)
  // -----------------------------------------------------------------
  function createCard(stream) {
    const card = players.createCardElement(stream);
    card.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      handleCardAction(button.dataset.action, stream.id, card);
    });
    cardElements.set(stream.id, card);
    pendingMounts.add(stream.id);
    return card;
  }

  function getOrCreateCardElement(stream) {
    return cardElements.get(stream.id) || createCard(stream);
  }

  /** Instancia o player oficial (Twitch/YouTube) de cards recém-criados,
   * agora que já estão de fato anexados ao documento. */
  function flushPendingMounts() {
    if (pendingMounts.size === 0) return;
    const ids = Array.from(pendingMounts);
    pendingMounts.clear();
    ids.forEach((id) => {
      const stream = state.streams.find((s) => s.id === id);
      const cardEl = cardElements.get(id);
      if (stream && cardEl && document.contains(cardEl)) {
        players.mountPlayer(cardEl, stream);
      }
    });
  }

  // ===================================================================
  // OPERAÇÕES VISUAIS — nunca criam, destroem ou recarregam players.
  // Só manipulam display/grid/flex/classes/posição dos cards que já
  // existem em `cardElements`.
  // ===================================================================

  /**
   * Sincroniza a tela (grid normal / modo foco / vazio / gaveta de
   * ocultos) com o estado atual. É o motor por trás de
   * updateStreamGrid(), applyFocusLayout() e applySavedLayout().
   */
  function syncView() {
    const streams = state.streams;
    const visibleStreams = streams.filter((s) => s.visible !== false);
    const hiddenStreams = streams.filter((s) => s.visible === false);

    streams.forEach((stream) => getOrCreateCardElement(stream));

    // Streams ocultas ficam "estacionadas", mas continuam montadas no
    // DOM — o player correspondente nunca é destruído.
    layout.syncContainerOrder(el.hiddenStash, hiddenStreams.map((s) => s.id), cardElements);

    if (visibleStreams.length === 0) {
      el.emptyState.classList.remove("is-hidden");
      el.streamsGrid.classList.add("is-hidden");
      el.focusRow.classList.add("is-hidden");
      el.focusSecondaryRow.classList.add("is-hidden");
      el.streamsArea.classList.remove("is-focus-mode");
      updateMuteAllButtonUI();
      renderStreamList();
      flushPendingMounts();
      return;
    }

    el.emptyState.classList.add("is-hidden");

    if (focus.isFocusModeActive(visibleStreams)) {
      el.streamsGrid.classList.add("is-hidden");
      el.focusRow.classList.remove("is-hidden");
      el.focusSecondaryRow.classList.remove("is-hidden");
      el.streamsArea.classList.add("is-focus-mode");

      focus.syncFocusContainers(el.focusRow, el.focusSecondaryRow, visibleStreams, cardElements);
    } else {
      el.focusRow.classList.add("is-hidden");
      el.focusSecondaryRow.classList.add("is-hidden");
      el.streamsArea.classList.remove("is-focus-mode");
      el.streamsGrid.classList.remove("is-hidden");

      const ordered = layout.sortStreamsForDisplay(visibleStreams);
      layout.updateGridCount(el.streamsGrid, ordered.length);
      layout.syncContainerOrder(el.streamsGrid, ordered.map((s) => s.id), cardElements);
      layout.enableDragAndDrop(el.streamsGrid, reorderStreams);
    }

    updateMuteAllButtonUI();
    renderStreamList();
    flushPendingMounts(); // só monta quem é realmente novo
  }

  /** Alias explícito: reorganiza o grid (tamanho/posição). Só visual. */
  function updateStreamGrid() {
    syncView();
  }

  /** Alias explícito: entra/sai do modo foco. Só visual — os mesmos
   * elementos de player continuam montados, apenas mudam de container. */
  function applyFocusLayout() {
    syncView();
  }

  /**
   * Aplica um layout salvo REORGANIZANDO as streams já abertas — nunca
   * chama a API de resolução de canal, nunca cria/recria players. As
   * streams do layout salvo que já estão abertas (mesma
   * plataforma+canal) são reordenadas e repinadas; as demais streams
   * abertas continuam onde estavam, anexadas ao final.
   */
  function applySavedLayout(name) {
    const data = layout.getLayout(name);
    if (!data) return;

    const remaining = [...state.streams];
    const matched = [];

    data.streams.forEach((saved) => {
      const idx = remaining.findIndex(
        (s) => s.platform === saved.platform && s.channel.toLowerCase() === saved.channel.toLowerCase()
      );
      if (idx !== -1) {
        const [stream] = remaining.splice(idx, 1);
        stream.pinned = !!saved.pinned; // só posição — nunca o player
        matched.push(stream);
      }
    });

    state.streams = [...matched, ...remaining];

    updateStreamGrid(); // só reposiciona/redimensiona
    persistIfAutoSave();
    showToast(`Layout "${name}" aplicado.`);
  }

  /** Oculta/mostra uma stream. Puramente visual — o player permanece
   * montado (só é movido para a gaveta escondida e de volta). */
  function toggleVisibility(id) {
    const stream = state.streams.find((s) => s.id === id);
    if (!stream) return;
    stream.visible = stream.visible === false ? true : false;
    updateStreamGrid();
    persistIfAutoSave();
  }

  function togglePin(id) {
    const stream = state.streams.find((s) => s.id === id);
    if (!stream) return;
    stream.pinned = !stream.pinned;

    const cardEl = cardElements.get(id);
    if (cardEl) players.applyStateClasses(cardEl, stream);

    updateStreamGrid(); // pode reposicionar, nunca recria o player
    persistIfAutoSave();
  }

  function toggleFocusOnStream(id) {
    const result = focus.toggleFocus(state.streams, id);
    if (!result.ok) {
      showToast(result.reason);
      return;
    }
    state.streams = result.streams;

    const updatedStream = state.streams.find((s) => s.id === id);
    const cardEl = cardElements.get(id);
    if (cardEl && updatedStream) players.applyStateClasses(cardEl, updatedStream);

    applyFocusLayout();
    persistIfAutoSave();
  }

  function reorderStreams(draggedId, targetId) {
    const streams = state.streams;
    const fromIndex = streams.findIndex((s) => s.id === draggedId);
    const toIndex = streams.findIndex((s) => s.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;

    const [moved] = streams.splice(fromIndex, 1);
    streams.splice(toIndex, 0, moved);

    updateStreamGrid();
    persistIfAutoSave();
  }

  function persistIfAutoSave() {
    if (state.settings.autoSave) {
      layout.saveLayout(AUTOSAVE_LAYOUT_NAME, state.streams);
    }
  }

  // ===================================================================
  // OPERAÇÕES DE PLAYER — únicas que criam/recriam/destroem players:
  // adicionar, editar (quando muda canal/plataforma), refresh
  // individual e refresh geral. Tudo escopado à(s) stream(s) envolvida(s).
  // ===================================================================

  function buildStreamFromApiResponse(data, extra) {
    return {
      id: generateId(),
      platform: data.platform,
      channel: data.channel,
      embedUrl: data.embed_url,
      isLive: !!data.is_live,
      found: data.found !== false,
      statusMessage: data.message || null,
      muted: state.settings.autoMute,
      pinned: false,
      focused: false,
      visible: true,
      paused: false,
      quality: state.settings.quality, // fixa no momento da criação
      ...extra,
    };
  }

  async function addStream(platform, channelRaw) {
    const channel = channelRaw.trim();
    if (!channel) return;

    const alreadyExists = state.streams.some(
      (s) => s.platform === platform && s.channel.toLowerCase() === channel.toLowerCase()
    );
    if (alreadyExists) {
      showToast("Essa live já foi adicionada.");
      return;
    }

    try {
      const data = await api.resolveChannel(platform, channel);
      const stream = buildStreamFromApiResponse(data);

      // Cria só o player NOVO — nenhum outro card é tocado.
      state.streams.push(stream);
      syncView();
      persistIfAutoSave();

      if (stream.isLive) {
        showToast(`${stream.channel} adicionado.`);
      } else {
        showToast(stream.statusMessage || "Canal adicionado, mas não está ao vivo no momento.");
      }
    } catch (err) {
      showToast(err.message || "Erro ao adicionar a live.");
    }
  }

  function removeStream(id) {
    const cardEl = cardElements.get(id);

    const finish = () => {
      players.disposePlayer(id);
      cardElements.delete(id);
      pendingMounts.delete(id);
      state.streams = state.streams.filter((s) => s.id !== id);
      syncView();
      persistIfAutoSave();
    };

    if (cardEl) {
      players.removeCardElement(cardEl, finish);
    } else {
      finish();
    }
  }

  function toggleMute(id) {
    const stream = state.streams.find((s) => s.id === id);
    if (!stream) return;
    stream.muted = !stream.muted;

    const cardEl = cardElements.get(id);
    if (cardEl) {
      players.applyMute(cardEl, stream); // via API oficial quando possível
      players.applyStateClasses(cardEl, stream);
    }
    persistIfAutoSave();
    updateMuteAllButtonUI();
  }

  /**
   * Atualiza uma única stream (usado pelo botão "Verificar novamente" do
   * card, pelo refresh individual do painel de gerenciamento e pelo
   * refresh geral). É a única rotina — além de adicionar/editar — que
   * pode recriar o player, e sempre só o dessa stream.
   */
  async function refreshSingleStream(id, options) {
    const silent = !!(options && options.silent);
    const stream = state.streams.find((s) => s.id === id);
    if (!stream) return;

    try {
      const data = await api.resolveChannel(stream.platform, stream.channel);
      stream.embedUrl = data.embed_url;
      stream.isLive = !!data.is_live;
      stream.found = data.found !== false;
      stream.statusMessage = data.message || null;
      stream.paused = false;

      const cardEl = cardElements.get(id);
      if (cardEl) {
        players.refreshPlayerBody(cardEl, stream);
        players.mountPlayer(cardEl, stream);
      }
      persistIfAutoSave();
      renderStreamList();
      if (!silent) showToast(`${stream.channel} atualizado.`);
    } catch (err) {
      if (!silent) showToast(err.message || "Erro ao verificar a stream.");
    }
  }

  /** Refresh geral — única ação que recria explicitamente todos os
   * players, a pedido do usuário. Mantém layout/pin/foco/ocultos. */
  async function reloadAllStreams() {
    if (state.streams.length === 0) return;
    showToast("Recarregando todas as streams...");
    for (const stream of state.streams) {
      await refreshSingleStream(stream.id, { silent: true });
    }
    showToast("Todas as streams foram recarregadas.");
  }

  function handleCardAction(action, id, cardEl) {
    switch (action) {
      case "remove":
        removeStream(id);
        break;
      case "mute":
        toggleMute(id);
        break;
      case "pin":
        togglePin(id);
        break;
      case "focus":
        toggleFocusOnStream(id);
        break;
      case "chat":
        players.toggleChatPanel(cardEl);
        break;
      case "edit":
        openEditModal(id);
        break;
      case "fullscreen":
        players.requestFullscreen(cardEl);
        break;
      case "retry":
        refreshSingleStream(id);
        break;
      default:
        break;
    }
  }

  // -----------------------------------------------------------------
  // EDITAR STREAM (modal)
  // -----------------------------------------------------------------
  let editingStreamId = null;

  function openEditModal(id) {
    const stream = state.streams.find((s) => s.id === id);
    if (!stream) return;

    editingStreamId = id;
    el.editPlatformSelect.value = stream.platform;
    el.editChannelInput.value = stream.channel;
    el.editModalOverlay.classList.remove("is-hidden");
    el.editChannelInput.focus();
  }

  function closeEditModal() {
    el.editModalOverlay.classList.add("is-hidden");
    editingStreamId = null;
  }

  el.btnCloseEditModal.addEventListener("click", closeEditModal);
  el.btnCancelEdit.addEventListener("click", closeEditModal);
  el.editModalOverlay.addEventListener("click", (event) => {
    if (event.target === el.editModalOverlay) closeEditModal();
  });

  el.editStreamForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!editingStreamId) return;

    const stream = state.streams.find((s) => s.id === editingStreamId);
    if (!stream) return;

    const newPlatform = el.editPlatformSelect.value;
    const newChannel = el.editChannelInput.value.trim();
    if (!newChannel) return;

    const unchanged =
      newPlatform === stream.platform && newChannel.toLowerCase() === stream.channel.toLowerCase();

    if (unchanged) {
      // Nada mudou de verdade -> não mexe no player.
      closeEditModal();
      showToast("Nenhuma alteração para salvar.");
      return;
    }

    try {
      const data = await api.resolveChannel(newPlatform, newChannel);

      // Troca real de canal/plataforma -> só ESTA stream tem o player
      // recriado; id, posição, pin, foco e visibilidade não mudam.
      stream.platform = data.platform;
      stream.channel = data.channel;
      stream.embedUrl = data.embed_url;
      stream.isLive = !!data.is_live;
      stream.found = data.found !== false;
      stream.statusMessage = data.message || null;

      const cardEl = cardElements.get(stream.id);
      if (cardEl) {
        players.updateCardHeader(cardEl, stream);
        players.refreshPlayerBody(cardEl, stream);
        players.mountPlayer(cardEl, stream);
        players.applyStateClasses(cardEl, stream);
      }

      persistIfAutoSave();
      closeEditModal();
      renderStreamList();
      showToast("Stream atualizada.");
    } catch (err) {
      showToast(err.message || "Erro ao atualizar a stream.");
    }
  });

  // -----------------------------------------------------------------
  // FORMULÁRIO "ADICIONAR STREAM"
  // -----------------------------------------------------------------
  el.btnAddStream.addEventListener("click", () => {
    el.addStreamPanel.classList.toggle("is-hidden");
    if (!el.addStreamPanel.classList.contains("is-hidden")) {
      el.channelInput.focus();
    }
  });

  el.addStreamForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const platform = el.platformSelect.value;
    const channel = el.channelInput.value;
    addStream(platform, channel);
    el.channelInput.value = "";
  });

  // -----------------------------------------------------------------
  // MUTE GLOBAL (compartilhado entre a navbar e o painel de streams)
  // -----------------------------------------------------------------
  function updateMuteAllButtonUI() {
    if (state.streams.length === 0) {
      el.btnMuteAll.textContent = "🔊";
      el.btnMuteAll.setAttribute("aria-pressed", "false");
      el.btnMuteAll.classList.remove("is-active");
      return;
    }
    const allMuted = state.streams.every((s) => s.muted);
    el.btnMuteAll.textContent = allMuted ? "🔇" : "🔊";
    el.btnMuteAll.setAttribute("aria-pressed", String(allMuted));
    el.btnMuteAll.classList.toggle("is-active", allMuted);
  }

  function handleMuteAllToggle() {
    if (state.streams.length === 0) return;
    const allMuted = state.streams.every((s) => s.muted);
    const nextMuted = !allMuted;

    state.streams.forEach((stream) => {
      stream.muted = nextMuted;
      const cardEl = cardElements.get(stream.id);
      if (cardEl) {
        players.applyMute(cardEl, stream);
        players.applyStateClasses(cardEl, stream);
      }
    });

    updateMuteAllButtonUI();
    persistIfAutoSave();
    showToast(nextMuted ? "Todas as streams foram mutadas." : "Todas as streams foram desmutadas.");
  }

  el.btnMuteAll.addEventListener("click", handleMuteAllToggle);

  // -----------------------------------------------------------------
  // PLAY/PAUSE EM MASSA (painel "Gerenciar Streams")
  // -----------------------------------------------------------------
  function pauseAllStreams() {
    if (state.streams.length === 0) return;
    state.streams.forEach((stream) => {
      if (!stream.isLive) return;
      stream.paused = true;
      const cardEl = cardElements.get(stream.id);
      if (cardEl) players.applyPause(cardEl, stream);
    });
    showToast("Streams pausadas (quando suportado pela plataforma).");
  }

  function playAllPausedStreams() {
    const pausedStreams = state.streams.filter((s) => s.paused);
    if (pausedStreams.length === 0) {
      showToast("Nenhuma stream pausada no momento.");
      return;
    }
    pausedStreams.forEach((stream) => {
      stream.paused = false;
      const cardEl = cardElements.get(stream.id);
      if (cardEl) players.applyPlay(cardEl, stream);
    });
    showToast("Streams retomadas (quando suportado pela plataforma).");
  }

  el.btnPlayAllPaused.addEventListener("click", playAllPausedStreams);
  el.btnPauseAll.addEventListener("click", pauseAllStreams);
  el.btnMuteAllPanel.addEventListener("click", handleMuteAllToggle);
  el.btnReloadAll.addEventListener("click", reloadAllStreams);

  // -----------------------------------------------------------------
  // TEMA
  // -----------------------------------------------------------------
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    state.settings.theme = theme;
    el.settingTheme.value = theme;
    el.btnTheme.textContent = theme === "blue" ? "🔵" : "🌙";
    saveSettings();
  }

  el.btnTheme.addEventListener("click", () => {
    const next = state.settings.theme === "dark" ? "blue" : "dark";
    applyTheme(next);
  });

  el.settingTheme.addEventListener("change", (e) => applyTheme(e.target.value));

  // -----------------------------------------------------------------
  // SIDEBAR DE CONFIGURAÇÕES
  // -----------------------------------------------------------------
  function openSettings() {
    el.sidebar.classList.add("is-open");
    el.sidebarOverlay.classList.add("is-open");
    renderSavedLayoutsList();
  }

  function closeSettings() {
    el.sidebar.classList.remove("is-open");
    el.sidebarOverlay.classList.remove("is-open");
  }

  el.btnSettings.addEventListener("click", openSettings);
  el.btnCloseSettings.addEventListener("click", closeSettings);
  el.sidebarOverlay.addEventListener("click", closeSettings);

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    } catch (err) {
      console.warn("Não foi possível salvar as configurações:", err);
    }
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      Object.assign(state.settings, JSON.parse(raw));
    } catch (err) {
      console.warn("Não foi possível carregar as configurações:", err);
    }
  }

  function applySettingsToUI() {
    el.settingTheme.value = state.settings.theme;
    el.settingQuality.value = state.settings.quality;
    el.settingAutoMute.checked = state.settings.autoMute;
    el.settingAutoFocus.checked = state.settings.autoFocus;
    el.settingLanguage.value = state.settings.language;
    el.settingAutoSave.checked = state.settings.autoSave;
    document.documentElement.setAttribute("data-theme", state.settings.theme);
    el.btnTheme.textContent = state.settings.theme === "blue" ? "🔵" : "🌙";
    updateQualityNote();
  }

  // -----------------------------------------------------------------
  // QUALIDADE PADRÃO
  // -----------------------------------------------------------------
  // Guardada no LocalStorage e aplicada só a NOVAS streams (fica presa
  // em `stream.quality` no momento da criação). Mudar a configuração
  // aqui nunca toca em `state.streams` — logo, streams já abertas nunca
  // são afetadas nem recarregadas.
  function updateQualityNote() {
    if (!el.qualityNote) return;
    el.qualityNote.textContent =
      "Aplicada apenas a novas streams, via API oficial de cada player quando disponível " +
      "(Twitch Player.setQuality, YouTube setPlaybackQuality). O Kick não expõe API de " +
      "qualidade para o player embutido — a stream inicia na qualidade padrão do player.";
  }

  el.settingQuality.addEventListener("change", (e) => {
    state.settings.quality = e.target.value;
    saveSettings();
    showToast("Qualidade padrão atualizada para novas streams.");
  });

  el.settingAutoMute.addEventListener("change", (e) => {
    state.settings.autoMute = e.target.checked;
    saveSettings();
  });

  el.settingAutoFocus.addEventListener("change", (e) => {
    state.settings.autoFocus = e.target.checked;
    saveSettings();
  });

  el.settingLanguage.addEventListener("change", (e) => {
    state.settings.language = e.target.value;
    saveSettings();
  });

  el.settingAutoSave.addEventListener("change", (e) => {
    state.settings.autoSave = e.target.checked;
    saveSettings();
    if (state.settings.autoSave) persistIfAutoSave();
  });

  // -----------------------------------------------------------------
  // MENU "LAYOUTS SALVOS" (ícone de grade na navbar)
  // -----------------------------------------------------------------
  function openLayoutMenu() {
    renderLayoutMenuList();
    el.layoutMenuDropdown.classList.remove("is-hidden");
    el.btnLayoutMenu.setAttribute("aria-expanded", "true");
    document.addEventListener("click", handleLayoutMenuOutsideClick);
  }

  function closeLayoutMenu() {
    el.layoutMenuDropdown.classList.add("is-hidden");
    el.btnLayoutMenu.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", handleLayoutMenuOutsideClick);
  }

  function handleLayoutMenuOutsideClick(event) {
    if (!el.layoutMenuDropdown.contains(event.target) && event.target !== el.btnLayoutMenu) {
      closeLayoutMenu();
    }
  }

  function renderLayoutMenuList() {
    const layouts = layout.listLayouts().filter((l) => l.name !== AUTOSAVE_LAYOUT_NAME);
    if (layouts.length === 0) {
      el.layoutMenuList.innerHTML = `<p class="layout-menu__empty">Nenhum layout salvo ainda.</p>`;
      return;
    }
    el.layoutMenuList.innerHTML = "";
    layouts.forEach(({ name }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "layout-menu__item";
      btn.textContent = name;
      btn.dataset.applyLayout = name;
      el.layoutMenuList.appendChild(btn);
    });
  }

  el.btnLayoutMenu.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = !el.layoutMenuDropdown.classList.contains("is-hidden");
    if (isOpen) closeLayoutMenu();
    else openLayoutMenu();
  });

  el.layoutMenuList.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-apply-layout]");
    if (!btn) return;
    applySavedLayout(btn.dataset.applyLayout); // só reorganiza, nunca recarrega
    closeLayoutMenu();
  });

  el.btnManageLayouts.addEventListener("click", () => {
    closeLayoutMenu();
    openSettings();
  });

  // -----------------------------------------------------------------
  // LAYOUTS SALVOS (dentro de Configurações — salvar/gerenciar/excluir)
  // -----------------------------------------------------------------
  function renderSavedLayoutsList() {
    const layouts = layout.listLayouts().filter((l) => l.name !== AUTOSAVE_LAYOUT_NAME);

    if (layouts.length === 0) {
      el.savedLayoutsList.innerHTML = `<p class="text-secondary" style="font-size: var(--font-size-sm);">
        Nenhum layout salvo ainda.
      </p>`;
      return;
    }

    el.savedLayoutsList.innerHTML = "";
    layouts.forEach(({ name }) => {
      const item = document.createElement("div");
      item.className = "saved-layout-item";
      item.innerHTML = `
        <span>${name}</span>
        <div class="saved-layout-item__actions">
          <button class="btn btn--sm" data-apply="${name}">Aplicar</button>
          <button class="btn btn--sm btn--danger" data-delete="${name}">Excluir</button>
        </div>
      `;
      el.savedLayoutsList.appendChild(item);
    });
  }

  el.savedLayoutsList.addEventListener("click", (event) => {
    const applyBtn = event.target.closest("[data-apply]");
    const deleteBtn = event.target.closest("[data-delete]");

    if (applyBtn) {
      applySavedLayout(applyBtn.dataset.apply); // idem: só reorganiza
    } else if (deleteBtn) {
      layout.deleteLayout(deleteBtn.dataset.delete);
      renderSavedLayoutsList();
      showToast("Layout excluído.");
    }
  });

  el.btnSaveCurrentLayout.addEventListener("click", () => {
    if (state.streams.length === 0) {
      showToast("Adicione ao menos uma live antes de salvar um layout.");
      return;
    }
    const name = window.prompt(
      "Nome do layout (ex: Campeonato, Duo, Quad Grid, Esports, Custom):"
    );
    if (!name) return;
    layout.saveLayout(name.trim(), state.streams);
    renderSavedLayoutsList();
    showToast(`Layout "${name.trim()}" salvo.`);
  });

  // -----------------------------------------------------------------
  // PAINEL "GERENCIAR STREAMS"
  // -----------------------------------------------------------------
  function openStreamList() {
    el.streamListSidebar.classList.add("is-open");
    el.streamListOverlay.classList.add("is-open");
    renderStreamList();
  }

  function closeStreamList() {
    el.streamListSidebar.classList.remove("is-open");
    el.streamListOverlay.classList.remove("is-open");
  }

  el.btnStreamList.addEventListener("click", openStreamList);
  el.btnCloseStreamList.addEventListener("click", closeStreamList);
  el.streamListOverlay.addEventListener("click", closeStreamList);

  function renderStreamList() {
    if (!el.streamListItems) return;

    if (state.streams.length === 0) {
      el.streamListItems.innerHTML = `<p class="text-secondary" style="font-size: var(--font-size-sm); padding: 8px;">
        Nenhuma stream adicionada.
      </p>`;
      return;
    }

    el.streamListItems.innerHTML = "";
    state.streams.forEach((stream) => {
      const item = document.createElement("div");
      item.className = "stream-list-item";
      item.dataset.id = stream.id;

      const statusClass = stream.isLive ? "is-online" : "is-offline";
      const statusLabel = stream.isLive ? "online" : "offline";
      const isHidden = stream.visible === false;
      const visibilityIcon = isHidden ? "🚫" : "👁";
      const visibilityTitle = isHidden ? "Mostrar" : "Ocultar";

      item.innerHTML = `
        <div class="stream-list-item__info">
          <span class="stream-list-item__name">${stream.channel}</span>
          <span class="stream-list-item__status ${statusClass}">${statusLabel}</span>
          ${isHidden ? '<span class="stream-list-item__status is-offline">oculta</span>' : ""}
        </div>
        <div class="stream-list-item__actions">
          <button class="btn btn--icon btn--sm" data-action="toggle-visibility" title="${visibilityTitle}">${visibilityIcon}</button>
          <button class="btn btn--icon btn--sm" data-action="edit" title="Editar">✏️</button>
          <button class="btn btn--icon btn--sm" data-action="refresh" title="Atualizar">↻</button>
        </div>
      `;
      el.streamListItems.appendChild(item);
    });
  }

  el.streamListItems.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-action]");
    if (!btn) return;
    const itemEl = event.target.closest(".stream-list-item");
    if (!itemEl) return;
    const id = itemEl.dataset.id;

    switch (btn.dataset.action) {
      case "toggle-visibility":
        toggleVisibility(id); // só visual
        break;
      case "edit":
        openEditModal(id);
        break;
      case "refresh":
        refreshSingleStream(id); // recria só esta stream, explicitamente
        break;
      default:
        break;
    }
  });

  // -----------------------------------------------------------------
  // INICIALIZAÇÃO
  // -----------------------------------------------------------------
  async function init() {
    loadSettings();
    applySettingsToUI();

    if (state.settings.autoSave) {
      const autosave = layout.getLayout(AUTOSAVE_LAYOUT_NAME);
      if (autosave && autosave.streams.length > 0) {
        await loadAutosave(autosave);
      }
    }

    syncView();
  }

  async function loadAutosave(autosave) {
    for (const saved of autosave.streams) {
      try {
        const resolved = await api.resolveChannel(saved.platform, saved.channel);
        const stream = buildStreamFromApiResponse(resolved, {
          muted: saved.muted ?? state.settings.autoMute,
          pinned: saved.pinned ?? false,
        });
        state.streams.push(stream);
      } catch (err) {
        console.warn(`Falha ao restaurar ${saved.channel}:`, err);
      }
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();