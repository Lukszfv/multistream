from flask import Flask, render_template, jsonify, request
from datetime import datetime

app = Flask(__name__)

SUPPORTED_PLATFORMS = ["twitch", "youtube", "kick"]

def resolve_twitch(channel: str) -> dict:
    """Resolve um canal da Twitch (mock).

    No futuro: chamar a Twitch Helix API (GET /streams?user_login=...)
    usando um token de aplicação (Client Credentials Flow).
    """
    return {
        "platform": "twitch",
        "channel": channel,
        "is_live": True,
        "title": f"Live de {channel} (dado fictício)",
        "embed_url": f"https://player.twitch.tv/?channel={channel}",
        "thumbnail": None,
        "checked_at": datetime.utcnow().isoformat() + "Z",
    }


def resolve_youtube(channel: str) -> dict:
    """Resolve um canal do YouTube (mock).

    No futuro: chamar a YouTube Data API v3 (search.list com
    eventType=live) para descobrir o videoId da live atual do canal.
    """
    return {
        "platform": "youtube",
        "channel": channel,
        "is_live": True,
        "title": f"Live de {channel} (dado fictício)",
        "embed_url": f"https://www.youtube.com/embed/live_stream?channel={channel}",
        "thumbnail": None,
        "checked_at": datetime.utcnow().isoformat() + "Z",
    }


def resolve_kick(channel: str) -> dict:
    """Resolve um canal do Kick (mock).

    No futuro: chamar a API pública/privada do Kick para checar o
    status da live e obter metadados adicionais.
    """
    return {
        "platform": "kick",
        "channel": channel,
        "is_live": True,
        "title": f"Live de {channel} (dado fictício)",
        "embed_url": f"https://player.kick.com/{channel}",
        "thumbnail": None,
        "checked_at": datetime.utcnow().isoformat() + "Z",
    }

RESOLVERS = {
    "twitch": resolve_twitch,
    "youtube": resolve_youtube,
    "kick": resolve_kick,
}

@app.route("/")
def index():
    """Renderiza a página principal da aplicação."""
    return render_template("index.html")

@app.route("/api/<platform>", methods=["GET"])
def resolve_channel(platform: str):
    """Endpoint genérico de resolução de canal.

    Exemplo de uso:
        GET /api/twitch?channel=algumcanal
        GET /api/youtube?channel=algumcanal
        GET /api/kick?channel=algumcanal

    Retorna um JSON padronizado (ver RESOLVERS acima) contendo a URL
    de embed pronta para o frontend usar num <iframe>.
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

    resolver = RESOLVERS[platform]
    data = resolver(channel)

    return jsonify(data), 200


@app.route("/api/platforms", methods=["GET"])
def list_platforms():
    """Retorna a lista de plataformas atualmente suportadas.

    Útil para o frontend popular dinamicamente o <select> de
    plataformas sem precisar hardcodar a lista em JS.
    """
    return jsonify({"platforms": SUPPORTED_PLATFORMS}), 200

if __name__ == "__main__":
    app.run(debug=True, port=5000)