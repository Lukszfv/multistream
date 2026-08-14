import re
from datetime import datetime

import requests
from flask import Flask, render_template, jsonify, request

app = Flask(__name__)

SUPPORTED_PLATFORMS = ["twitch", "youtube", "kick"]

BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
}

REQUEST_TIMEOUT = 6  # segundos


def _now_iso():
    return datetime.utcnow().isoformat() + "Z"


def _response(platform, channel, found, is_live, title=None, embed_url=None, message=None):
    return {
        "platform": platform,
        "channel": channel,
        "found": found,
        "is_live": is_live,
        "title": title,
        "embed_url": embed_url,
        "message": message,
        "checked_at": _now_iso(),
    }

def resolve_twitch(channel: str) -> dict:
    channel = channel.strip().lstrip("@")
    if not channel:
        return _response("twitch", channel, found=False, is_live=False,
                          message="Informe o nome do canal da Twitch.")
    return _response(
        "twitch", channel, found=True, is_live=True,
        title=f"Live de {channel} (dado fictício)",
        embed_url=f"https://player.twitch.tv/?channel={channel}",
    )

def resolve_kick(channel: str) -> dict:
    channel = channel.strip().lstrip("@")
    if not channel:
        return _response("kick", channel, found=False, is_live=False,
                          message="Informe o nome do canal do Kick.")
    return _response(
        "kick", channel, found=True, is_live=True,
        title=f"Live de {channel} (dado fictício)",
        embed_url=f"https://player.kick.com/{channel}",
    )

YOUTUBE_CHANNEL_ID_RE = re.compile(r"^UC[\w-]{20,}$")


def _normalize_youtube_target(raw: str):
    """Retorna (kind, value):
      kind = "video" -> value é um video_id já conhecido (link direto)
      kind = "path"  -> value é o caminho do canal (ex.: "/@canal")
    """
    raw = raw.strip()

    video_match = re.search(
        r"(?:youtube\.com/(?:watch\?v=|live/)|youtu\.be/)([\w-]{11})", raw
    )
    if video_match:
        return "video", video_match.group(1)

    url_match = re.search(
        r"youtube\.com/(channel/UC[\w-]{20,}|@[\w.\-]+|c/[\w.\-]+|user/[\w.\-]+)",
        raw, re.IGNORECASE,
    )
    if url_match:
        return "path", "/" + url_match.group(1)

    if YOUTUBE_CHANNEL_ID_RE.match(raw):
        return "path", f"/channel/{raw}"

    if raw.startswith("@"):
        return "path", f"/{raw}"

    return "path", f"/@{raw}"


def _fetch_youtube_html(url: str):
    try:
        resp = requests.get(url, headers=BROWSER_HEADERS, timeout=REQUEST_TIMEOUT)
        return resp.status_code, resp.text
    except requests.RequestException:
        return None, None


def _extract_live_video_id(html: str):
    if not html:
        return None

    is_live_now = '"isLiveNow":true' in html or '"isLive":true' in html
    if not is_live_now:
        return None

    canonical_match = re.search(
        r'<link rel="canonical" href="https://www\.youtube\.com/watch\?v=([\w-]{11})"', html
    )
    if canonical_match:
        return canonical_match.group(1)

    video_id_match = re.search(r'"videoId":"([\w-]{11})"', html)
    if video_id_match:
        return video_id_match.group(1)

    return None


def _extract_title(html: str, fallback: str) -> str:
    if not html:
        return fallback
    title_match = re.search(r"<title>(.*?)</title>", html)
    if not title_match:
        return fallback
    return title_match.group(1).replace(" - YouTube", "").strip() or fallback


def resolve_youtube(raw_channel: str) -> dict:
    raw_channel = raw_channel.strip()

    if not raw_channel:
        return _response("youtube", raw_channel, found=False, is_live=False,
                          message="Informe o nome, @usuário, URL ou ID do canal.")

    kind, value = _normalize_youtube_target(raw_channel)

    if kind == "video":
        return _response(
            "youtube", raw_channel, found=True, is_live=True,
            title="Vídeo/Live informado diretamente",
            embed_url=f"https://www.youtube.com/embed/{value}",
        )

    live_url = f"https://www.youtube.com{value}/live"
    status_code, html = _fetch_youtube_html(live_url)

    if status_code is None:
        return _response(
            "youtube", raw_channel, found=False, is_live=False,
            message="Não foi possível conectar ao YouTube para verificar este canal. Tente novamente.",
        )

    if status_code == 404:
        return _response(
            "youtube", raw_channel, found=False, is_live=False,
            message="Canal do YouTube não encontrado. Verifique o nome, @usuário ou URL informado.",
        )

    if status_code != 200:
        return _response(
            "youtube", raw_channel, found=False, is_live=False,
            message=f"Não foi possível verificar este canal no momento (status {status_code}). Tente novamente em instantes.",
        )

    video_id = _extract_live_video_id(html)

    if not video_id:
        return _response(
            "youtube", raw_channel, found=True, is_live=False,
            message="Este canal não está ao vivo.",
        )

    title = _extract_title(html, fallback=raw_channel)

    return _response(
        "youtube", raw_channel, found=True, is_live=True,
        title=title, embed_url=f"https://www.youtube.com/embed/{video_id}",
    )


RESOLVERS = {
    "twitch": resolve_twitch,
    "youtube": resolve_youtube,
    "kick": resolve_kick,
}


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/<platform>", methods=["GET"])
def resolve_channel(platform: str):
    """GET /api/twitch|youtube|kick?channel=...

    Sempre retorna 200 com o contrato padronizado (mesmo quando o
    canal está offline) — 400 é reservado para parâmetros inválidos.
    """
    platform = platform.lower()

    if platform not in SUPPORTED_PLATFORMS:
        return jsonify({
            "error": f"Plataforma '{platform}' não é suportada.",
            "supported_platforms": SUPPORTED_PLATFORMS,
        }), 400

    channel = request.args.get("channel", "").strip()
    if not channel:
        return jsonify({"error": "Parâmetro 'channel' é obrigatório."}), 400

    return jsonify(RESOLVERS[platform](channel)), 200


@app.route("/api/platforms", methods=["GET"])
def list_platforms():
    return jsonify({"platforms": SUPPORTED_PLATFORMS}), 200


if __name__ == "__main__":
    app.run(debug=True, port=5000)