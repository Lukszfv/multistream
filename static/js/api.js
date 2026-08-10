(function () {
  "use strict";

  window.MSH = window.MSH || {};

  /**
   * Resolve um canal em uma plataforma específica, consultando o
   * backend Flask. Retorna uma Promise que resolve para o objeto
   * padronizado:
   *   { platform, channel, is_live, title, embed_url, thumbnail, checked_at }
   *
   * @param {string} platform
   * @param {string} channel
   * @returns {Promise<Object>}
   */
  async function resolveChannel(platform, channel) {
    const url = `/api/${encodeURIComponent(platform)}?channel=${encodeURIComponent(channel)}`;

    const response = await fetch(url);

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.error || "Não foi possível resolver o canal.");
    }

    return response.json();
  }

  /**
   * Consulta a lista de plataformas suportadas pelo backend.
   * Usado para, futuramente, popular o <select> dinamicamente sem
   * precisar hardcodar as opções no HTML.
   *
   * @returns {Promise<string[]>}
   */
  async function getSupportedPlatforms() {
    const response = await fetch("/api/platforms");

    if (!response.ok) {
      return ["twitch", "youtube", "kick"];
    }

    const data = await response.json();
    return data.platforms || ["twitch", "youtube", "kick"];
  }

  window.MSH.api = {
    resolveChannel,
    getSupportedPlatforms,
  };
})();
